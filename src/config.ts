import * as v from "valibot";

export type Config = {
	port: number;
	accessTeamDomain: string;
	accessAudience: string;
	browserCdpUrl: string | undefined;
	browserMaxConcurrency: number;
	ssrfExtraBlockedCidrs: string | undefined;
	maxTextChars: number;
	userAgent: string;
	/** Miniflux の新着を地区で振り分けて Discord に送る。MINIFLUX_WEBHOOK_SECRET が無ければ使わない */
	routing: RoutingConfig | undefined;
};

export type RoutingConfig = {
	minifluxWebhookSecret: string;
	d1AccountId: string;
	d1DatabaseId: string;
	d1ApiToken: string;
	refreshSeconds: number;
	/** 通知先の名前 → Discord の webhook の URL */
	discordWebhooks: ReadonlyMap<string, string>;
};

const DiscordWebhooksSchema = v.pipe(
	v.string(),
	v.parseJson(),
	v.record(
		v.pipe(v.string(), v.minLength(1)),
		v.pipe(
			v.string(),
			v.check((s) => {
				try {
					const u = new URL(s);
					return (
						u.protocol === "https:" &&
						(u.hostname === "discord.com" || u.hostname === "discordapp.com") &&
						u.pathname.startsWith("/api/webhooks/")
					);
				} catch {
					return false;
				}
			}, "must be a https://discord.com/api/webhooks/ URL"),
		),
	),
);

const intString = (min: number, max: number) =>
	v.pipe(
		v.string(),
		v.regex(/^\d+$/, "must be an integer"),
		v.transform(Number),
		v.minValue(min),
		v.maxValue(max),
	);

const required = v.pipe(v.string("is required"), v.minLength(1, "is required"));

const EnvSchema = v.object({
	PORT: v.optional(intString(1, 65535), "8080"),
	CF_ACCESS_TEAM_DOMAIN: required,
	CF_ACCESS_AUD: required,
	BROWSER_CDP_URL: v.optional(
		v.pipe(
			v.string(),
			v.check((s) => {
				try {
					const { protocol } = new URL(s);
					return protocol === "ws:" || protocol === "wss:";
				} catch {
					return false;
				}
			}, "must be a ws:// or wss:// URL"),
		),
	),
	BROWSER_MAX_CONCURRENCY: v.optional(intString(1, 10), "2"),
	SSRF_EXTRA_BLOCKED_CIDRS: v.optional(v.string()),
	MAX_TEXT_CHARS: v.optional(intString(1, Number.MAX_SAFE_INTEGER), "20000"),
	MINIFLUX_WEBHOOK_SECRET: v.optional(v.string()),
	AREA_MAPS_D1_ACCOUNT_ID: v.optional(v.string()),
	AREA_MAPS_D1_DATABASE_ID: v.optional(v.string()),
	AREA_MAPS_D1_API_TOKEN: v.optional(v.string()),
	AREA_MAPS_REFRESH_SECONDS: v.optional(intString(10, 86400), "300"),
	DISCORD_WEBHOOKS: v.optional(DiscordWebhooksSchema),
	USER_AGENT: v.optional(
		v.string(),
		"chatsumi/0.0 (+https://github.com/ochanuco/chatsumi)",
	),
});

export function loadConfig(env: NodeJS.ProcessEnv): Config {
	// 空文字は未設定として扱う
	const input = Object.fromEntries(
		Object.entries(env).filter(([, value]) => value !== ""),
	);
	const result = v.safeParse(EnvSchema, input);
	if (!result.success) {
		const lines = result.issues.map(
			(issue) => `  ${v.getDotPath(issue) ?? "env"}: ${issue.message}`,
		);
		throw new Error(`invalid environment variables:\n${lines.join("\n")}`);
	}
	const e = result.output;
	return {
		routing: loadRouting(e),
		port: e.PORT,
		accessTeamDomain: e.CF_ACCESS_TEAM_DOMAIN,
		accessAudience: e.CF_ACCESS_AUD,
		browserCdpUrl: e.BROWSER_CDP_URL,
		browserMaxConcurrency: e.BROWSER_MAX_CONCURRENCY,
		ssrfExtraBlockedCidrs: e.SSRF_EXTRA_BLOCKED_CIDRS,
		maxTextChars: e.MAX_TEXT_CHARS,
		userAgent: e.USER_AGENT,
	};
}

function loadRouting(
	e: v.InferOutput<typeof EnvSchema>,
): RoutingConfig | undefined {
	const secret = e.MINIFLUX_WEBHOOK_SECRET;
	if (secret === undefined) return undefined;
	const missing = (
		[
			["AREA_MAPS_D1_ACCOUNT_ID", e.AREA_MAPS_D1_ACCOUNT_ID],
			["AREA_MAPS_D1_DATABASE_ID", e.AREA_MAPS_D1_DATABASE_ID],
			["AREA_MAPS_D1_API_TOKEN", e.AREA_MAPS_D1_API_TOKEN],
			["DISCORD_WEBHOOKS", e.DISCORD_WEBHOOKS],
		] as const
	)
		.filter(([, value]) => value === undefined)
		.map(
			([name]) => `  ${name}: is required when MINIFLUX_WEBHOOK_SECRET is set`,
		);
	if (missing.length > 0) {
		throw new Error(`invalid environment variables:\n${missing.join("\n")}`);
	}
	return {
		minifluxWebhookSecret: secret,
		d1AccountId: e.AREA_MAPS_D1_ACCOUNT_ID as string,
		d1DatabaseId: e.AREA_MAPS_D1_DATABASE_ID as string,
		d1ApiToken: e.AREA_MAPS_D1_API_TOKEN as string,
		refreshSeconds: e.AREA_MAPS_REFRESH_SECONDS,
		discordWebhooks: new Map(Object.entries(e.DISCORD_WEBHOOKS ?? {})),
	};
}
