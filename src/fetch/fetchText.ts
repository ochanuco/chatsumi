import type { FetchMode, FetchText, FetchTextResponse } from "../api.ts";
import type { Config } from "../config.ts";
import {
	decodeHtmlBestEffort,
	extractCharsetFromContentType,
} from "../extract/charset.ts";
import { extractDocument, extractPlainText } from "../extract/html.ts";
import { truncateText } from "../extract/truncate.ts";
import type { Result } from "../result.ts";
import { type BrowserFetcher, createBrowserFetcher } from "./browser.ts";
import type { FetchError, FetchErrorType } from "./errors.ts";
import { type HttpResponse, httpGet } from "./http.ts";
import {
	defaultResolver,
	isBlockedAddress,
	parseCidrList,
	vetUrl,
} from "./ssrf.ts";

const HTTP_TIMEOUT_MS = 20_000;
const BROWSER_TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const EMPTY_TEXT_THRESHOLD = 200;
const BLOCKED_TYPES: ReadonlySet<FetchErrorType> = new Set([
	"forbidden",
	"challenge",
	"rate_limited",
]);

export type FetchTextDeps = {
	httpGet: (url: string) => Promise<Result<HttpResponse, FetchError>>;
	browserGet: BrowserFetcher | null;
	maxTextChars: number;
};

export function createFetchText(config: Config): FetchText {
	const extraBlocked =
		config.ssrfExtraBlockedCidrs === undefined
			? undefined
			: parseCidrList(config.ssrfExtraBlockedCidrs);
	const ssrf = { resolve: defaultResolver, extraBlocked };
	return createFetchTextWith({
		httpGet: (url) =>
			httpGet(url, {
				...ssrf,
				timeoutMs: HTTP_TIMEOUT_MS,
				maxBytes: MAX_BYTES,
				maxRedirects: MAX_REDIRECTS,
				userAgent: config.userAgent,
			}),
		browserGet:
			config.browserCdpUrl === undefined
				? null
				: createBrowserFetcher({
						cdpUrl: config.browserCdpUrl,
						timeoutMs: BROWSER_TIMEOUT_MS,
						maxConcurrency: config.browserMaxConcurrency,
						vet: (url) => vetUrl(url, ssrf),
						isBlockedAddress: (address) =>
							isBlockedAddress(address, extraBlocked),
					}),
		maxTextChars: config.maxTextChars,
	});
}

export function createFetchTextWith(deps: FetchTextDeps): FetchText {
	const viaHttp = async (url: string): Promise<FetchTextResponse> => {
		const res = await deps.httpGet(url);
		if (!res.ok) return failure(res.error, "http");
		const { body, contentType, finalUrl, status } = res.value;
		const decoded = decodeHtmlBestEffort(
			body,
			extractCharsetFromContentType(contentType),
		);
		const doc = isPlainText(contentType)
			? { title: null, text: extractPlainText(decoded) }
			: extractDocument(decoded);
		return success(doc, finalUrl, "http", status, deps.maxTextChars);
	};

	const viaBrowser = async (url: string): Promise<FetchTextResponse> => {
		if (!deps.browserGet) {
			return failure(
				{ type: "browser_unavailable", message: "browser is not configured" },
				"browser",
			);
		}
		const res = await deps.browserGet(url);
		if (!res.ok) return failure(res.error, "browser");
		const { html, finalUrl, status } = res.value;
		return success(
			extractDocument(html),
			finalUrl,
			"browser",
			status,
			deps.maxTextChars,
		);
	};

	return async ({ url, mode }) => {
		if (mode === "http") return viaHttp(url);
		if (mode === "browser") return viaBrowser(url);

		const first = await viaHttp(url);
		if (!deps.browserGet) return first;
		if (first.ok) {
			if (first.text.length >= EMPTY_TEXT_THRESHOLD) return first;
			// 中身が薄いだけなら http の結果も答えになるので、browser が失敗したらそちらを返す
			const retried = await viaBrowser(url);
			return retried.ok ? retried : first;
		}
		if (!BLOCKED_TYPES.has(first.error.type)) return first;
		return viaBrowser(url);
	};
}

function isPlainText(contentType: string | null): boolean {
	return contentType?.split(";")[0]?.trim().toLowerCase() === "text/plain";
}

function success(
	doc: { title: string | null; text: string },
	finalUrl: string,
	mode: FetchMode,
	status: number,
	maxTextChars: number,
): FetchTextResponse {
	const { text, truncated } = truncateText(doc.text, maxTextChars);
	return {
		ok: true,
		title: doc.title,
		text,
		truncated,
		finalUrl,
		mode,
		status,
	};
}

function failure(error: FetchError, mode: FetchMode): FetchTextResponse {
	return { ok: false, error: { ...error, mode } };
}
