import * as v from "valibot";
import type { PostJson } from "../outbound/post.ts";
import { err, ok, type Result } from "../result.ts";

export type AreaMapRow = { feed_id: string; doc: string };
export type LoadAreaMaps = () => Promise<Result<AreaMapRow[], string>>;

const QueryResponseSchema = v.object({
	success: v.literal(true),
	result: v.pipe(
		v.array(
			v.object({
				results: v.array(v.object({ feed_id: v.string(), doc: v.string() })),
			}),
		),
		v.minLength(1),
	),
});

/** D1 の REST API の `/query` で `area_maps` を読む。読み取り専用のトークンで足りる */
export function createD1AreaMapLoader(opts: {
	accountId: string;
	databaseId: string;
	apiToken: string;
	post: PostJson;
}): LoadAreaMaps {
	const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(opts.accountId)}/d1/database/${encodeURIComponent(opts.databaseId)}/query`;
	return async () => {
		const res = await opts.post(
			url,
			{ sql: "SELECT feed_id, doc FROM area_maps ORDER BY feed_id" },
			{ Authorization: `Bearer ${opts.apiToken}` },
		);
		if (!res.ok) return err(`${res.error.type}: ${res.error.message}`);
		if (res.value.status !== 200) return err(`d1 status ${res.value.status}`);
		let json: unknown;
		try {
			json = JSON.parse(res.value.body);
		} catch {
			return err("d1 returned invalid JSON");
		}
		const parsed = v.safeParse(QueryResponseSchema, json);
		if (!parsed.success) return err("d1 response has unexpected shape");
		return ok(parsed.output.result[0]?.results ?? []);
	};
}
