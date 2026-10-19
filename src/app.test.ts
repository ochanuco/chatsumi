import { describe, expect, it, vi } from "vitest";
import type { FetchText, FetchTextInput, FetchTextResponse } from "./api.ts";
import { createApp } from "./app.ts";

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
