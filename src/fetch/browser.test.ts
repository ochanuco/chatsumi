import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { err, ok } from "../result.ts";
import { createBrowserFetcher } from "./browser.ts";
import { fetchError } from "./errors.ts";

// CI には Chromium がないので、実行ファイルを渡したときだけ動かす
const executablePath = process.env.CHATSUMI_TEST_CHROME;

describe.skipIf(!executablePath)("createBrowserFetcher（実ブラウザ）", () => {
	let server: Server;
	let port: number;
	const hits: string[] = [];

	beforeAll(async () => {
		server = createServer((req, res) => {
			hits.push(req.url ?? "");
			if (req.url === "/rendered") {
				res.setHeader("content-type", "text/html; charset=utf-8");
				res.end(
					`<title>描画</title><div id="a"></div><script>document.getElementById("a").textContent = "スクリプトで書いた本文"</script>`,
				);
			} else if (req.url === "/with-image") {
				res.setHeader("content-type", "text/html; charset=utf-8");
				res.end(`<p>画像つき</p><img src="http://[::1]:${port}/secret-img">`);
			} else if (req.url === "/redirect") {
				res.statusCode = 302;
				res.setHeader("location", `http://[::1]:${port}/secret`);
				res.end();
			} else {
				res.setHeader("content-type", "text/html; charset=utf-8");
				res.end("<p>内部の秘密</p>");
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "::", resolve));
		port = (server.address() as AddressInfo).port;
	});

	afterAll(() => {
		server.close();
	});

	// 127.0.0.1 を外のサイト、::1 を内部のアドレスに見立てる
	const fetcher = () =>
		createBrowserFetcher({
			cdpUrl: "unused",
			timeoutMs: 15_000,
			maxConcurrency: 1,
			vet: async (url) =>
				url.hostname === "127.0.0.1"
					? ok(undefined)
					: err(fetchError("ssrf_blocked", "test")),
			isBlockedAddress: (address) => address === "::1",
			connect: () => chromium.launch({ executablePath, headless: true }),
		});

	it("スクリプトで描画した本文を取れる", async () => {
		const res = await fetcher()(`http://127.0.0.1:${port}/rendered`);
		expect(res.ok && res.value.html).toContain("スクリプトで書いた本文");
		expect(res).toMatchObject({ ok: true, value: { status: 200 } });
	});

	it("内部のアドレスへのサブリソースは止まる", async () => {
		const res = await fetcher()(`http://127.0.0.1:${port}/with-image`);
		expect(res.ok && res.value.html).toContain("画像つき");
		expect(hits).not.toContain("/secret-img");
	});

	it("リダイレクトで内部のアドレスに届いたら結果を捨てる", async () => {
		const res = await fetcher()(`http://127.0.0.1:${port}/redirect`);
		expect(res).toMatchObject({ ok: false, error: { type: "ssrf_blocked" } });
	});

	it("最初の URL が検査で弾かれたらブラウザにつながない", async () => {
		let connected = false;
		const res = await createBrowserFetcher({
			cdpUrl: "unused",
			timeoutMs: 15_000,
			maxConcurrency: 1,
			vet: async () => err(fetchError("ssrf_blocked", "test")),
			isBlockedAddress: () => false,
			connect: async () => {
				connected = true;
				throw new Error("unreachable");
			},
		})("http://[::1]/");
		expect(res).toMatchObject({ ok: false, error: { type: "ssrf_blocked" } });
		expect(connected).toBe(false);
	});
});

describe("createBrowserFetcher", () => {
	it("ブラウザにつながらなければ browser_unavailable", async () => {
		const res = await createBrowserFetcher({
			cdpUrl: "unused",
			timeoutMs: 1_000,
			maxConcurrency: 1,
			vet: async () => ok(undefined),
			isBlockedAddress: () => false,
			connect: async () => {
				throw new Error("refused");
			},
		})("https://example.com/");
		expect(res).toMatchObject({
			ok: false,
			error: { type: "browser_unavailable" },
		});
	});
});
