import { createHmac, timingSafeEqual } from "node:crypto";
import * as v from "valibot";

/** Miniflux は本文の生のバイト列を HMAC-SHA256 にかけ、16 進で `X-Miniflux-Signature` に入れる */
export function verifyMinifluxSignature(
	rawBody: Uint8Array,
	signature: string | undefined,
	secret: string,
): boolean {
	if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
	const expected = createHmac("sha256", secret).update(rawBody).digest();
	return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/** `new_entries` の要求のうち、使う欄だけを確かめる */
export const NewEntriesSchema = v.object({
	feed: v.object({ id: v.number() }),
	entries: v.array(
		v.object({
			id: v.number(),
			feed_id: v.number(),
			title: v.string(),
			url: v.string(),
			content: v.optional(v.string(), ""),
		}),
	),
});

export type NewEntries = v.InferOutput<typeof NewEntriesSchema>;
export type MinifluxEntry = NewEntries["entries"][number];
