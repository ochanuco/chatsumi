import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { err, ok, type Result } from "../result.ts";
import { classifyStatus, hasChallengeSignal } from "./classify.ts";
import { type FetchError, fetchError } from "./errors.ts";
import {
	type ExtraBlockList,
	type ResolvedAddress,
	type Resolver,
	vetUrl,
} from "./ssrf.ts";

export type HttpFetchOptions = {
	resolve: Resolver;
	extraBlocked?: ExtraBlockList;
	timeoutMs: number;
	maxBytes: number;
	maxRedirects: number;
	userAgent: string;
	/** テスト専用。検証済みアドレスの接続先 (ポート含む) を差し替える。本番は常に検証済みアドレスへ接続する */
	pin?: (vetted: ResolvedAddress) => ConnectTarget;
};

export type ConnectTarget = ResolvedAddress & { port?: number };

export type HttpResponse = {
	status: number;
	finalUrl: string;
	contentType: string | null;
	body: Uint8Array;
};

const MAX_URL_LENGTH = 2048;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set([
	"text/html",
	"application/xhtml+xml",
	"text/plain",
]);

type BodyMode = "none" | "strict" | "lenient";

type RawResponse = {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: Uint8Array;
};

function pinnedLookup(target: ResolvedAddress): LookupFunction {
	return (_hostname, options, callback) => {
		if (options.all) {
			(
				callback as unknown as (err: null, addresses: ResolvedAddress[]) => void
			)(null, [target]);
		} else {
			callback(null, target.address, target.family);
		}
	};
}

function responseDecoder(encoding: string | undefined) {
	switch ((encoding ?? "").toLowerCase().trim()) {
		case "gzip":
		case "x-gzip":
			return createGunzip();
		case "deflate":
			return createInflate();
		case "br":
			return createBrotliDecompress();
		default:
			return null;
	}
}

function bodyModeFor(
	status: number,
	headers: http.IncomingHttpHeaders,
): BodyMode {
	if (status >= 200 && status < 300) {
		return isAllowedContentType(headers["content-type"]) ? "strict" : "none";
	}
	if (status === 403 || status === 503) return "lenient";
	return "none";
}

function isAllowedContentType(value: string | undefined): boolean {
	if (value === undefined || value.trim() === "") return true;
	const mime = (value.split(";")[0] ?? "").trim().toLowerCase();
	return ALLOWED_CONTENT_TYPES.has(mime);
}

function hop(
	url: URL,
	target: ConnectTarget,
	opts: HttpFetchOptions,
	signal: AbortSignal,
): Promise<Result<RawResponse, FetchError>> {
	const isHttps = url.protocol === "https:";
	const hostname = url.hostname.startsWith("[")
		? url.hostname.slice(1, -1)
		: url.hostname;
	const lib = isHttps ? https : http;
	const port = target.port ?? (url.port === "" ? undefined : Number(url.port));

	return new Promise((resolvePromise) => {
		let settled = false;
		const settle = (r: Result<RawResponse, FetchError>) => {
			if (settled) return;
			settled = true;
			resolvePromise(r);
		};
		const fail = (e: unknown) => {
			if (signal.aborted) {
				settle(err(fetchError("timeout", "total timeout exceeded")));
				return;
			}
			const code =
				e instanceof Error && "code" in e ? String(e.code) : "request failed";
			settle(err(fetchError("network_error", `request failed: ${code}`)));
		};

		const req = lib.request(
			{
				method: "GET",
				host: hostname,
				port,
				path: `${url.pathname}${url.search}`,
				headers: {
					"user-agent": opts.userAgent,
					accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
					"accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
					"accept-encoding": "gzip, deflate, br",
					connection: "close",
				},
				lookup: pinnedLookup(target),
				servername: isHttps && isIP(hostname) === 0 ? hostname : undefined,
				agent: false,
				signal,
				maxHeaderSize: 32 * 1024,
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const headers = res.headers;
				const empty = () =>
					settle(ok({ status, headers, body: new Uint8Array() }));
				if (REDIRECT_STATUSES.has(status)) {
					res.resume();
					empty();
					return;
				}
				const mode = bodyModeFor(status, headers);
				if (mode === "none") {
					res.destroy();
					empty();
					return;
				}
				const declared = Number(headers["content-length"]);
				if (Number.isFinite(declared) && declared > opts.maxBytes) {
					res.destroy();
					if (mode === "strict") {
						settle(
							err(fetchError("too_large", "content-length exceeds limit")),
						);
					} else {
						empty();
					}
					return;
				}

				const decoder = responseDecoder(headers["content-encoding"]);
				const source = decoder ? res.pipe(decoder) : res;
				if (decoder) res.on("error", (e) => decoder.destroy(e));

				const chunks: Buffer[] = [];
				let total = 0;
				source.on("data", (chunk: Buffer) => {
					if (settled) return;
					total += chunk.length;
					if (total > opts.maxBytes) {
						res.destroy();
						source.destroy();
						if (mode === "strict") {
							settle(err(fetchError("too_large", "body exceeds limit")));
						} else {
							empty();
						}
						return;
					}
					chunks.push(chunk);
				});
				source.on("end", () =>
					settle(ok({ status, headers, body: Buffer.concat(chunks) })),
				);
				source.on("error", fail);
				res.on("error", fail);
			},
		);
		req.on("error", fail);
		req.end();
	});
}

function toResponse(
	raw: RawResponse,
	finalUrl: string,
): Result<HttpResponse, FetchError> {
	const { status, headers, body } = raw;
	const challenged =
		(status === 403 || status === 503) &&
		hasChallengeSignal(Object.keys(headers), new TextDecoder().decode(body));
	const failure = classifyStatus(status, challenged);
	if (failure) return err(failure);
	if (!isAllowedContentType(headers["content-type"])) {
		return err(
			fetchError("unsupported_content_type", "content type not supported"),
		);
	}
	return ok({
		status,
		finalUrl,
		contentType: headers["content-type"] ?? null,
		body,
	});
}

export async function httpGet(
	url: string,
	opts: HttpFetchOptions,
): Promise<Result<HttpResponse, FetchError>> {
	if (url.length > MAX_URL_LENGTH) {
		return err(fetchError("ssrf_blocked", "url too long"));
	}
	let current: URL;
	try {
		current = new URL(url);
	} catch {
		return err(fetchError("ssrf_blocked", "invalid url"));
	}

	const controller = new AbortController();
	const timeoutError = err(fetchError("timeout", "total timeout exceeded"));
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
	// DNS 解決のように signal を受け取れない処理も総時間の上限に収める
	const deadline = new Promise<typeof timeoutError>((resolveDeadline) => {
		controller.signal.addEventListener(
			"abort",
			() => resolveDeadline(timeoutError),
			{ once: true },
		);
	});

	try {
		for (let redirects = 0; ; redirects++) {
			const vetted = await Promise.race([
				vetUrl(current, {
					resolve: opts.resolve,
					extraBlocked: opts.extraBlocked,
				}),
				deadline,
			]);
			if (!vetted.ok) return vetted;
			const target = opts.pin ? opts.pin(vetted.value) : vetted.value;

			const result = await Promise.race([
				hop(current, target, opts, controller.signal),
				deadline,
			]);
			if (!result.ok) return result;
			const raw = result.value;

			if (REDIRECT_STATUSES.has(raw.status)) {
				const location = raw.headers.location;
				if (typeof location !== "string" || location === "") {
					return err(fetchError("network_error", "redirect without location"));
				}
				if (redirects >= opts.maxRedirects) {
					return err(fetchError("network_error", "too many redirects"));
				}
				try {
					current = new URL(location, current);
				} catch {
					return err(fetchError("network_error", "invalid redirect location"));
				}
				if (current.href.length > MAX_URL_LENGTH) {
					return err(fetchError("ssrf_blocked", "url too long"));
				}
				continue;
			}
			return toResponse(raw, current.toString());
		}
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}
