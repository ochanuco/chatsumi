import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../result.ts";
import type { BrowserFetcher } from "./browser.ts";
import { fetchError } from "./errors.ts";
import { createFetchTextWith, type FetchTextDeps } from "./fetchText.ts";

const URL_ = "https://example.com/a";
const LONG = "あ".repeat(300);

function html(body: string, title = "題"): Uint8Array {
	return new TextEncoder().encode(
		`<html><head><title>${title}</title></head><body><p>${body}</p></body></html>`,
	);
}

function httpOk(body: string, contentType = "text/html; charset=utf-8") {
	return vi.fn<FetchTextDeps["httpGet"]>(async () =>
		ok({ status: 200, finalUrl: URL_, contentType, body: html(body) }),
	);
}

function browserOk(body: string) {
	return vi.fn<BrowserFetcher>(async () =>
		ok({
			status: 200,
			finalUrl: `${URL_}#rendered`,
			html: `<title>描画後</title><p>${body}</p>`,
		}),
	);
}

describe("createFetchTextWith", () => {
	it("http で十分な本文が取れたら browser を使わない", async () => {
		const browserGet = browserOk(LONG);
		const fetchText = createFetchTextWith({
			httpGet: httpOk(LONG),
			browserGet,
			maxTextChars: 20_000,
		});
		const res = await fetchText({ url: URL_ });
		expect(res).toMatchObject({
			ok: true,
			title: "題",
			mode: "http",
			status: 200,
		});
		expect(browserGet).not.toHaveBeenCalled();
	});

	it.each(["forbidden", "challenge", "rate_limited"] as const)(
		"http が %s で弾かれたら browser でやり直す",
		async (type) => {
			const fetchText = createFetchTextWith({
				httpGet: async () => err(fetchError(type, "x")),
				browserGet: browserOk(LONG),
				maxTextChars: 20_000,
			});
			expect(await fetchText({ url: URL_ })).toMatchObject({
				ok: true,
				title: "描画後",
				mode: "browser",
				finalUrl: `${URL_}#rendered`,
			});
		},
	);

	it("弾かれて browser も失敗したら browser の失敗を返す", async () => {
		const fetchText = createFetchTextWith({
			httpGet: async () => err(fetchError("challenge", "x")),
			browserGet: async () => err(fetchError("timeout", "y")),
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_ })).toEqual({
			ok: false,
			error: { type: "timeout", message: "y", mode: "browser" },
		});
	});

	it("本文が空に近ければ browser でやり直す", async () => {
		const fetchText = createFetchTextWith({
			httpGet: httpOk(""),
			browserGet: browserOk(LONG),
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_ })).toMatchObject({
			ok: true,
			mode: "browser",
		});
	});

	it("空に近くて browser が失敗したら http の結果を返す", async () => {
		const fetchText = createFetchTextWith({
			httpGet: httpOk("短い"),
			browserGet: async () => err(fetchError("browser_unavailable", "y")),
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_ })).toMatchObject({
			ok: true,
			mode: "http",
			text: "短い",
		});
	});

	it.each([
		"ssrf_blocked",
		"not_found",
		"auth_required",
		"too_large",
		"timeout",
	] as const)("%s はやり直さない", async (type) => {
		const browserGet = browserOk(LONG);
		const fetchText = createFetchTextWith({
			httpGet: async () => err(fetchError(type, "x")),
			browserGet,
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_ })).toMatchObject({
			ok: false,
			error: { type, mode: "http" },
		});
		expect(browserGet).not.toHaveBeenCalled();
	});

	it("browser が設定されていなければ http の結果をそのまま返す", async () => {
		const fetchText = createFetchTextWith({
			httpGet: async () => err(fetchError("forbidden", "x")),
			browserGet: null,
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_ })).toMatchObject({
			ok: false,
			error: { type: "forbidden", mode: "http" },
		});
	});

	it("mode を指定したらその取り方だけを使う", async () => {
		const httpGet = httpOk("");
		const browserGet = browserOk(LONG);
		const fetchText = createFetchTextWith({
			httpGet,
			browserGet,
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_, mode: "http" })).toMatchObject({
			mode: "http",
		});
		expect(browserGet).not.toHaveBeenCalled();
		expect(await fetchText({ url: URL_, mode: "browser" })).toMatchObject({
			mode: "browser",
		});
		expect(httpGet).toHaveBeenCalledTimes(1);
	});

	it("browser が設定されていないのに browser を指定したら browser_unavailable", async () => {
		const fetchText = createFetchTextWith({
			httpGet: httpOk(LONG),
			browserGet: null,
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_, mode: "browser" })).toMatchObject({
			ok: false,
			error: { type: "browser_unavailable", mode: "browser" },
		});
	});

	it("本文を切り詰める", async () => {
		const fetchText = createFetchTextWith({
			httpGet: httpOk(LONG),
			browserGet: null,
			maxTextChars: 10,
		});
		expect(await fetchText({ url: URL_ })).toMatchObject({
			ok: true,
			text: "あ".repeat(10),
			truncated: true,
		});
	});

	it("text/plain は本文をそのまま使い、タイトルは null", async () => {
		const fetchText = createFetchTextWith({
			httpGet: async () =>
				ok({
					status: 200,
					finalUrl: URL_,
					contentType: "text/plain",
					body: new TextEncoder().encode("<p>そのまま</p>"),
				}),
			browserGet: null,
			maxTextChars: 20_000,
		});
		expect(await fetchText({ url: URL_ })).toMatchObject({
			ok: true,
			title: null,
			text: "<p>そのまま</p>",
		});
	});
});
