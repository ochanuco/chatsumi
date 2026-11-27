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
			routing: undefined,
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

	describe("routing", () => {
		const routing = {
			MINIFLUX_WEBHOOK_SECRET: "s",
			AREA_MAPS_D1_ACCOUNT_ID: "acct",
			AREA_MAPS_D1_DATABASE_ID: "db",
			AREA_MAPS_D1_API_TOKEN: "tok",
			DISCORD_WEBHOOKS:
				'{"minato":"https://discord.com/api/webhooks/1/x?thread_id=2"}',
		};

		it("MINIFLUX_WEBHOOK_SECRET が無ければ使わない", () => {
			const { MINIFLUX_WEBHOOK_SECRET: _s, ...rest } = routing;
			expect(loadConfig({ ...base, ...rest }).routing).toBeUndefined();
		});

		it("そろっていれば読む", () => {
			const r = loadConfig({ ...base, ...routing }).routing;
			expect(r).toMatchObject({
				minifluxWebhookSecret: "s",
				d1AccountId: "acct",
				d1DatabaseId: "db",
				d1ApiToken: "tok",
				refreshSeconds: 300,
			});
			expect(r?.discordWebhooks.get("minato")).toBe(
				"https://discord.com/api/webhooks/1/x?thread_id=2",
			);
		});

		it("欠けていれば変数名つきで投げる", () => {
			const { AREA_MAPS_D1_API_TOKEN: _t, ...rest } = routing;
			expect(() => loadConfig({ ...base, ...rest })).toThrow(
				/AREA_MAPS_D1_API_TOKEN/,
			);
		});

		it("Discord の webhook 以外の URL や壊れた JSON で投げる", () => {
			for (const DISCORD_WEBHOOKS of [
				'{"a":"https://example.com/api/webhooks/1/x"}',
				'{"a":"http://discord.com/api/webhooks/1/x"}',
				"{not json",
			]) {
				expect(() =>
					loadConfig({ ...base, ...routing, DISCORD_WEBHOOKS }),
				).toThrow(/DISCORD_WEBHOOKS/);
			}
		});
	});
});
