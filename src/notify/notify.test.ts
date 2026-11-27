import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createD1AreaMapLoader } from "../areas/d1.ts";
import { type AreaMap, compileAreaMap } from "../areas/rules.ts";
import { createPostJson, type PostJson } from "../outbound/post.ts";
import { err, ok } from "../result.ts";
import { createSendDiscord, formatEntryMessage } from "./discord.ts";
import { verifyMinifluxSignature } from "./miniflux.ts";
import { createRouteEntries } from "./route.ts";

const response = (
	status: number,
	body = "",
	headers: Record<string, string> = {},
) => ok({ status, body, headers: new Headers(headers) });

describe("verifyMinifluxSignature", () => {
	const body = new TextEncoder().encode('{"event_type":"new_entries"}');
	const sig = createHmac("sha256", "s3cret").update(body).digest("hex");

	it("本文の HMAC-SHA256 の 16 進と一致すれば通す", () => {
		expect(verifyMinifluxSignature(body, sig, "s3cret")).toBe(true);
		expect(verifyMinifluxSignature(body, sig.toUpperCase(), "s3cret")).toBe(
			true,
		);
	});

	it("鍵違い、本文違い、欠落、形の違う署名を拒む", () => {
		expect(verifyMinifluxSignature(body, sig, "other")).toBe(false);
		expect(
			verifyMinifluxSignature(new TextEncoder().encode("{}"), sig, "s3cret"),
		).toBe(false);
		expect(verifyMinifluxSignature(body, undefined, "s3cret")).toBe(false);
		expect(verifyMinifluxSignature(body, "abc", "s3cret")).toBe(false);
	});
});

describe("formatEntryMessage", () => {
	it("地区名・見出し・URL の 2 行にする", () => {
		expect(
			formatEntryMessage("みなと", " 湊に\nパン屋 ", "https://example.com/1"),
		).toBe("[みなと] 湊に パン屋\nhttps://example.com/1");
	});

	it("2000 文字に収まるよう見出しを切る", () => {
		const msg = formatEntryMessage(
			"x",
			"あ".repeat(3000),
			"https://example.com/1",
		);
		expect(msg.length).toBe(2000);
		expect(msg.endsWith("…\nhttps://example.com/1")).toBe(true);
	});
});

describe("createSendDiscord", () => {
	it("メンションを効かせずに送る", async () => {
		const calls: unknown[] = [];
		const send = createSendDiscord({
			post: async (_url, body) => {
				calls.push(body);
				return response(204);
			},
		});
		expect((await send("https://discord.com/api/webhooks/1/x", "hi")).ok).toBe(
			true,
		);
		expect(calls).toEqual([{ content: "hi", allowed_mentions: { parse: [] } }]);
	});

	it("429 なら retry_after だけ待って 1 度だけやり直す", async () => {
		const waits: number[] = [];
		const statuses = [429, 429];
		const send = createSendDiscord({
			post: async () =>
				response(statuses.shift() ?? 204, '{"retry_after":1.5}'),
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		const result = await send("https://discord.com/api/webhooks/1/x", "hi");
		expect(waits).toEqual([1500]);
		expect(result).toEqual(err("discord status 429"));
	});
});

describe("createRouteEntries", () => {
	const map: AreaMap = compileAreaMap("town", {
		miniflux_feed_ids: [7],
		default: { tag: "area:other", label: "その他" },
		areas: [{ tag: "area:minato", label: "みなと", aliases: ["湊"] }],
		exclude: [],
		routes: { "area:minato": "minato", "area:other": "missing" },
	});
	const entry = (id: number, feed_id: number, title: string, content = "") => ({
		id,
		feed_id,
		title,
		url: `https://example.com/${id}`,
		content,
	});

	it("表のある feed だけを、地区の送り先に送る", async () => {
		const sent: Array<[string, string]> = [];
		const logs: Record<string, unknown>[] = [];
		const route = createRouteEntries({
			store: { forMinifluxFeed: (id) => (id === 7 ? map : undefined) },
			webhooks: new Map([["minato", "https://discord.com/api/webhooks/1/x"]]),
			send: async (url, content) => {
				sent.push([url, content]);
				return ok(undefined);
			},
			log: (line) => logs.push(line),
		});
		await route([
			entry(1, 7, "新しい店", "<p>湊の角に</p>"),
			entry(2, 8, "湊の話"),
			entry(3, 7, "天気の話"),
		]);
		expect(sent).toEqual([
			[
				"https://discord.com/api/webhooks/1/x",
				"[みなと] 新しい店\nhttps://example.com/1",
			],
		]);
		// 既定の地区の送り先は名前だけあって URL が無い
		expect(logs).toContainEqual(
			expect.objectContaining({ entryId: 3, result: "unknown_webhook" }),
		);
	});
});

describe("createD1AreaMapLoader", () => {
	const post =
		(status: number, body: string): PostJson =>
		async () =>
			response(status, body);
	const load = (p: PostJson) =>
		createD1AreaMapLoader({
			accountId: "a",
			databaseId: "d",
			apiToken: "t",
			post: p,
		})();

	it("query の結果の行を返す", async () => {
		const body = JSON.stringify({
			success: true,
			result: [{ results: [{ feed_id: "town", doc: "{}" }] }],
		});
		expect(await load(post(200, body))).toEqual(
			ok([{ feed_id: "town", doc: "{}" }]),
		);
	});

	it("認証の失敗や想定外の形は失敗として返す", async () => {
		expect((await load(post(403, "{}"))).ok).toBe(false);
		expect((await load(post(200, '{"success":false}'))).ok).toBe(false);
		expect((await load(post(200, "not json"))).ok).toBe(false);
	});

	it("SQL と Bearer トークンを送る", async () => {
		const seen: unknown[] = [];
		await load(async (url, body, headers) => {
			seen.push(url, body, headers);
			return response(500);
		});
		expect(seen).toEqual([
			"https://api.cloudflare.com/client/v4/accounts/a/d1/database/d/query",
			{ sql: "SELECT feed_id, doc FROM area_maps ORDER BY feed_id" },
			{ Authorization: "Bearer t" },
		]);
	});
});

describe("createPostJson", () => {
	const publicResolve = async () => [
		{ address: "93.184.216.34", family: 4 as const },
	];

	it("許したホスト以外と http には送らない", async () => {
		const post = createPostJson({
			resolve: publicResolve,
			fetchImpl: async () => {
				throw new Error("must not fetch");
			},
		});
		for (const url of [
			"https://example.com/x",
			"http://discord.com/api/webhooks/1/x",
		]) {
			expect(await post(url, {})).toMatchObject({
				ok: false,
				error: { type: "not_allowed" },
			});
		}
	});

	it("名前が内部のアドレスに解決されたら送らない", async () => {
		const post = createPostJson({
			resolve: async () => [{ address: "192.168.1.10", family: 4 }],
			fetchImpl: async () => {
				throw new Error("must not fetch");
			},
		});
		expect(
			await post("https://discord.com/api/webhooks/1/x", {}),
		).toMatchObject({
			ok: false,
			error: { type: "not_allowed" },
		});
	});

	it("リダイレクトを辿らず、JSON を POST する", async () => {
		let init: RequestInit | undefined;
		const post = createPostJson({
			resolve: publicResolve,
			fetchImpl: async (_u, i) => {
				init = i;
				return new Response("ok", { status: 200 });
			},
		});
		const res = await post("https://discord.com/api/webhooks/1/x", { a: 1 });
		expect(res).toMatchObject({ ok: true, value: { status: 200, body: "ok" } });
		expect(init).toMatchObject({
			method: "POST",
			redirect: "error",
			body: '{"a":1}',
		});
	});
});
