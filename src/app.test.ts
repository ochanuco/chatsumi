import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { FetchText, FetchTextInput, FetchTextResponse } from "./api.ts";
import { createApp } from "./app.ts";
import type { MinifluxEntry } from "./notify/miniflux.ts";

const okResponse: FetchTextResponse = {
	ok: true,
	title: "t",
	text: "body",
	truncated: false,
	finalUrl: "https://example.com/x",
	mode: "http",
	status: 200,
};

function setup(fetchText: FetchText = async () => okResponse) {
	const logs: Record<string, unknown>[] = [];
	const app = createApp({
		verifyAccess: async (token) => token === "good",
		fetchText,
		log: (line) => logs.push(line),
	});
	const post = (body: unknown, token: string | null = "good") =>
		app.request("/fetchText", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(token ? { "Cf-Access-Jwt-Assertion": token } : {}),
			},
			body: typeof body === "string" ? body : JSON.stringify(body),
		});
	return { app, logs, post };
}

describe("createApp", () => {
	it("healthz は認証なしで ok を返す", async () => {
		const res = await setup().app.request("/healthz");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("トークンなし・不正トークンは 401", async () => {
		const { post } = setup();
		for (const token of [null, "bad"]) {
			const res = await post({ url: "https://example.com" }, token);
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({
				ok: false,
				error: { type: "unauthorized" },
			});
		}
	});

	it("JSON が壊れていれば 400", async () => {
		const res = await setup().post("{not json");
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { type: string } }).error.type).toBe(
			"invalid_request",
		);
	});

	it.each([
		["不正な URL", { url: "not a url" }],
		["http(s) 以外のスキーム", { url: "file:///etc/passwd" }],
		["不正な mode", { url: "https://example.com", mode: "curl" }],
		["url 欠落", {}],
		["長すぎる URL", { url: `https://example.com/${"a".repeat(2048)}` }],
	])("%s は 400", async (_name, body) => {
		const res = await setup().post(body);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { type: string } }).error.type).toBe(
			"invalid_request",
		);
	});

	it("入力を fetchText に渡して結果を 200 で返す", async () => {
		const fetchText = vi.fn<(i: FetchTextInput) => Promise<FetchTextResponse>>(
			async () => okResponse,
		);
		const { post, logs } = setup(fetchText);
		const res = await post({
			url: "https://example.com/secret/path?q=1",
			mode: "browser",
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(okResponse);
		expect(fetchText).toHaveBeenCalledWith({
			url: "https://example.com/secret/path?q=1",
			mode: "browser",
		});
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			route: "/fetchText",
			method: "POST",
			status: 200,
			host: "example.com",
			result: "ok",
		});
		expect(JSON.stringify(logs)).not.toContain("secret");
	});

	it("失敗結果も 200 で返しログに error.type を残す", async () => {
		const failure: FetchTextResponse = {
			ok: false,
			error: { type: "timeout", message: "slow", mode: "http" },
		};
		const { post, logs } = setup(async () => failure);
		const res = await post({ url: "https://example.com" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(failure);
		expect(logs[0]).toMatchObject({ result: "timeout", mode: "http" });
	});

	it("fetchText が投げたら 500", async () => {
		const { post, logs } = setup(async () => {
			throw new Error("boom");
		});
		const res = await post({ url: "https://example.com" });
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			ok: false,
			error: { type: "internal_error" },
		});
		expect(logs[0]).toMatchObject({ status: 500, result: "internal_error" });
	});

	it("未知のルートは 404", async () => {
		const res = await setup().app.request("/nope", {
			headers: { "Cf-Access-Jwt-Assertion": "good" },
		});
		expect(res.status).toBe(404);
		expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
	});
});

describe("POST /webhooks/miniflux", () => {
	const secret = "s3cret";
	const payload = {
		event_type: "new_entries",
		feed: { id: 7 },
		entries: [
			{
				id: 1,
				feed_id: 7,
				title: "t",
				url: "https://example.com/1",
				content: "<p>x</p>",
			},
		],
	};

	function setupHook(enabled = true) {
		const routed: MinifluxEntry[][] = [];
		const logs: Record<string, unknown>[] = [];
		const app = createApp({
			verifyAccess: async () => false,
			fetchText: async () => okResponse,
			minifluxWebhook: enabled
				? {
						secret,
						routeEntries: async (entries) => {
							routed.push(entries);
						},
					}
				: undefined,
			log: (line) => logs.push(line),
		});
		const send = (body: string, opts: { sig?: string; event?: string } = {}) =>
			app.request("/webhooks/miniflux", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Miniflux-Event-Type": opts.event ?? "new_entries",
					"X-Miniflux-Signature":
						opts.sig ?? createHmac("sha256", secret).update(body).digest("hex"),
				},
				body,
			});
		return { app, routed, logs, send };
	}

	it("JWT が無くても、署名が合えば受けて振り分けに渡す", async () => {
		const { send, routed } = setupHook();
		const res = await send(JSON.stringify(payload));
		expect(res.status).toBe(202);
		expect(routed).toEqual([payload.entries]);
	});

	it("署名が合わなければ 401 で、振り分けに渡さない", async () => {
		const { send, routed } = setupHook();
		const res = await send(JSON.stringify(payload), { sig: "0".repeat(64) });
		expect(res.status).toBe(401);
		expect(routed).toEqual([]);
	});

	it("new_entries 以外のイベントは 204 で無視する", async () => {
		const { send, routed } = setupHook();
		const res = await send(JSON.stringify(payload), { event: "save_entry" });
		expect(res.status).toBe(204);
		expect(routed).toEqual([]);
	});

	it("形の違う本文は 400", async () => {
		const { send } = setupHook();
		expect((await send('{"entries":"x"}')).status).toBe(400);
		expect((await send("{not json")).status).toBe(400);
	});

	it("設定が無ければ 404", async () => {
		const { send } = setupHook(false);
		expect((await send(JSON.stringify(payload))).status).toBe(404);
	});

	it("振り分けが投げても、応答とプロセスに響かない", async () => {
		const logs: Record<string, unknown>[] = [];
		const app = createApp({
			verifyAccess: async () => false,
			fetchText: async () => okResponse,
			minifluxWebhook: {
				secret,
				routeEntries: async () => {
					throw new Error("boom");
				},
			},
			log: (line) => logs.push(line),
		});
		const body = JSON.stringify(payload);
		const res = await app.request("/webhooks/miniflux", {
			method: "POST",
			headers: {
				"X-Miniflux-Event-Type": "new_entries",
				"X-Miniflux-Signature": createHmac("sha256", secret)
					.update(body)
					.digest("hex"),
			},
			body,
		});
		expect(res.status).toBe(202);
		await new Promise((r) => setTimeout(r, 0));
		expect(logs).toContainEqual(
			expect.objectContaining({ component: "route", result: "internal_error" }),
		);
	});

	it("webhook の口を足しても、fetchText は JWT が無ければ 401", async () => {
		const { app } = setupHook();
		const res = await app.request("/fetchText", {
			method: "POST",
			body: JSON.stringify({ url: "https://example.com" }),
		});
		expect(res.status).toBe(401);
	});
});
