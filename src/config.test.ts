import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const base = { CF_ACCESS_TEAM_DOMAIN: "t.example", CF_ACCESS_AUD: "aud" };

describe("loadConfig", () => {
	it("既定値を補う", () => {
		expect(loadConfig(base)).toEqual({
			port: 8080,
			accessTeamDomain: "t.example",
			accessAudience: "aud",
			browserCdpUrl: undefined,
			browserMaxConcurrency: 2,
			ssrfExtraBlockedCidrs: undefined,
			maxTextChars: 20000,
			userAgent: "chatsumi/0.0 (+https://github.com/ochanuco/chatsumi)",
		});
	});

	it("指定値を読む", () => {
		const config = loadConfig({
			...base,
			PORT: "3000",
			BROWSER_CDP_URL: "ws://browser:9222",
			BROWSER_MAX_CONCURRENCY: "4",
			SSRF_EXTRA_BLOCKED_CIDRS: "10.1.0.0/16",
			MAX_TEXT_CHARS: "100",
			USER_AGENT: "ua",
		});
		expect(config).toMatchObject({
			port: 3000,
			browserCdpUrl: "ws://browser:9222",
			browserMaxConcurrency: 4,
			ssrfExtraBlockedCidrs: "10.1.0.0/16",
			maxTextChars: 100,
			userAgent: "ua",
		});
	});

	it("必須が無いと変数名つきで投げる", () => {
		expect(() => loadConfig({})).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
		expect(() => loadConfig({})).toThrow(/CF_ACCESS_AUD/);
	});

	it("不正な数値で投げる", () => {
		expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(/PORT/);
		expect(() =>
			loadConfig({ ...base, BROWSER_MAX_CONCURRENCY: "11" }),
		).toThrow(/BROWSER_MAX_CONCURRENCY/);
		expect(() => loadConfig({ ...base, BROWSER_MAX_CONCURRENCY: "0" })).toThrow(
			/BROWSER_MAX_CONCURRENCY/,
		);
	});

	it("ws/wss 以外の CDP URL で投げる", () => {
		expect(() =>
			loadConfig({ ...base, BROWSER_CDP_URL: "http://browser:9222" }),
		).toThrow(/BROWSER_CDP_URL/);
		expect(() => loadConfig({ ...base, BROWSER_CDP_URL: "nope" })).toThrow(
			/BROWSER_CDP_URL/,
		);
	});
});
