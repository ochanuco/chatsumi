import { defaultResolver, type Resolver, vetUrl } from "../fetch/ssrf.ts";
import { err, ok, type Result } from "../result.ts";

/** 設定で決まる宛先だけを許す。利用者が渡す URL には使わない（それは fetch/http.ts の仕事） */
export const ALLOWED_POST_HOSTS = new Set([
	"api.cloudflare.com",
	"discord.com",
	"discordapp.com",
]);

export type PostResponse = { status: number; headers: Headers; body: string };
export type PostError = {
	type: "not_allowed" | "network_error" | "timeout";
	message: string;
};
export type PostJson = (
	url: string,
	body: unknown,
	headers?: Record<string, string>,
) => Promise<Result<PostResponse, PostError>>;

export function createPostJson(
	opts: {
		resolve?: Resolver;
		timeoutMs?: number;
		fetchImpl?: typeof fetch;
	} = {},
): PostJson {
	const resolve = opts.resolve ?? defaultResolver;
	const fetchImpl = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 15_000;
	return async (url, body, headers = {}) => {
		const u = new URL(url);
		if (u.protocol !== "https:" || !ALLOWED_POST_HOSTS.has(u.hostname)) {
			return err({
				type: "not_allowed",
				message: `host not allowed: ${u.hostname}`,
			});
		}
		// 宛先は固定のホストだが、名前解決が宅内を指していないことは確かめる
		const vetted = await vetUrl(u, { resolve });
		if (!vetted.ok)
			return err({ type: "not_allowed", message: vetted.error.message });
		try {
			const res = await fetchImpl(u, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify(body),
				redirect: "error",
				signal: AbortSignal.timeout(timeoutMs),
			});
			return ok({
				status: res.status,
				headers: res.headers,
				body: await res.text(),
			});
		} catch (e) {
			if (e instanceof Error && e.name === "TimeoutError") {
				return err({ type: "timeout", message: "request timed out" });
			}
			return err({
				type: "network_error",
				message: e instanceof Error ? e.message : "unknown",
			});
		}
	};
}
