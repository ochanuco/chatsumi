import type { PostJson } from "../outbound/post.ts";
import { err, ok, type Result } from "../result.ts";

const MAX_CONTENT = 2000;
const MAX_RETRY_WAIT_MS = 30_000;

export function formatEntryMessage(
	label: string,
	title: string,
	url: string,
): string {
	const tail = `\n${url}`;
	const head = `[${label}] ${title.replace(/\s+/g, " ").trim()}`;
	const room = MAX_CONTENT - tail.length;
	return (
		(head.length > room ? `${head.slice(0, Math.max(0, room - 1))}…` : head) +
		tail
	);
}

export type SendDiscord = (
	webhookUrl: string,
	content: string,
) => Promise<Result<void, string>>;

export function createSendDiscord(opts: {
	post: PostJson;
	sleep?: (ms: number) => Promise<void>;
}): SendDiscord {
	const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	return async (webhookUrl, content) => {
		// 記事の見出しは外から来るので、@everyone などのメンションを効かせない
		const body = { content, allowed_mentions: { parse: [] } };
		for (let attempt = 0; attempt < 2; attempt++) {
			const res = await opts.post(webhookUrl, body);
			if (!res.ok) return err(`${res.error.type}: ${res.error.message}`);
			const { status } = res.value;
			if (status >= 200 && status < 300) return ok(undefined);
			if (status === 429 && attempt === 0) {
				await sleep(retryAfterMs(res.value.body, res.value.headers));
				continue;
			}
			return err(`discord status ${status}`);
		}
		return err("discord rate limited");
	};
}

function retryAfterMs(body: string, headers: Headers): number {
	let seconds = Number(headers.get("retry-after"));
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed && typeof parsed === "object" && "retry_after" in parsed) {
			const value = (parsed as { retry_after: unknown }).retry_after;
			if (typeof value === "number") seconds = value;
		}
	} catch {
		// 本文が JSON でなければ header の値を使う
	}
	if (!Number.isFinite(seconds) || seconds < 0) seconds = 1;
	return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}
