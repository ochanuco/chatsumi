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
};

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
