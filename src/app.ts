import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as v from "valibot";
import {
	type FetchText,
	type FetchTextInput,
	FetchTextInputSchema,
} from "./api.ts";
import {
	NewEntriesSchema,
	verifyMinifluxSignature,
} from "./notify/miniflux.ts";
import type { RouteEntries } from "./notify/route.ts";

const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;

export type AppDeps = {
	verifyAccess: (token: string | undefined) => Promise<boolean>;
	fetchText: FetchText;
	/** 無ければ webhook の口は 404 を返す */
	minifluxWebhook?: { secret: string; routeEntries: RouteEntries };
	log?: (line: Record<string, unknown>) => void;
};

export function createApp(deps: AppDeps): Hono {
	const log =
		deps.log ??
		((line: Record<string, unknown>) => console.log(JSON.stringify(line)));
	const app = new Hono();

	app.get("/healthz", (c) => c.json({ ok: true }));

	// Miniflux の webhook は Access のトークンを付けられないので、JWT の検証の前に置き、署名で確かめる
	app.post(
		"/webhooks/miniflux",
		// 認証より前に置く口なので、読み込む前に大きさで切る
		bodyLimit({
			maxSize: MAX_WEBHOOK_BYTES,
			onError: (c) => {
				log({
					route: "/webhooks/miniflux",
					method: "POST",
					status: 413,
					result: "too_large",
				});
				return c.json({ ok: false, error: { type: "too_large" } }, 413);
			},
		}),
		async (c) => {
			const hook = deps.minifluxWebhook;
			const entry: Record<string, unknown> = {
				route: "/webhooks/miniflux",
				method: "POST",
			};
			const reply = (
				status: 202 | 204 | 400 | 401 | 404 | 413,
				result: string,
			) => {
				log({ ...entry, status, result });
				return status === 202 || status === 204
					? c.body(null, status)
					: c.json({ ok: false, error: { type: result } }, status);
			};
			if (!hook) return reply(404, "not_found");
			const raw = new Uint8Array(await c.req.arrayBuffer());
			if (
				!verifyMinifluxSignature(
					raw,
					c.req.header("X-Miniflux-Signature"),
					hook.secret,
				)
			) {
				return reply(401, "unauthorized");
			}
			const eventType = c.req.header("X-Miniflux-Event-Type");
			entry.event = eventType;
			if (eventType !== "new_entries") return reply(204, "ignored");
			let body: unknown;
			try {
				body = JSON.parse(new TextDecoder().decode(raw));
			} catch {
				return reply(400, "invalid_request");
			}
			const parsed = v.safeParse(NewEntriesSchema, body);
			if (!parsed.success) return reply(400, "invalid_request");
			entry.entries = parsed.output.entries.length;
			// Discord への送信は件数しだいで長くかかるので、待たずに返す。送れなかった分も Miniflux には残る
			hook.routeEntries(parsed.output.entries).catch((e: unknown) => {
				log({
					component: "route",
					result: "internal_error",
					exception: e instanceof Error ? e.name : "unknown",
				});
			});
			return reply(202, "accepted");
		},
	);

	app.use("*", async (c, next) => {
		const token = c.req.header("Cf-Access-Jwt-Assertion");
		if (await deps.verifyAccess(token)) return next();
		log({
			route: c.req.path,
			method: c.req.method,
			status: 401,
			result: "unauthorized",
		});
		return c.json({ ok: false, error: { type: "unauthorized" } }, 401);
	});

	app.post("/fetchText", async (c) => {
		const startedAt = Date.now();
		const entry: Record<string, unknown> = {
			route: "/fetchText",
			method: "POST",
		};
		const finish = (status: number) => {
			log({ ...entry, status, durationMs: Date.now() - startedAt });
		};

		const body: unknown = await c.req.json().catch(() => undefined);
		if (body === undefined) {
			entry.result = "invalid_request";
			finish(400);
			return c.json(
				{
					ok: false,
					error: {
						type: "invalid_request",
						message: "body must be valid JSON",
					},
				},
				400,
			);
		}
		const parsed = v.safeParse(FetchTextInputSchema, body);
		if (!parsed.success) {
			entry.result = "invalid_request";
			finish(400);
			return c.json(
				{
					ok: false,
					error: {
						type: "invalid_request",
						message: parsed.issues
							.map((i) => `${v.getDotPath(i) ?? "body"}: ${i.message}`)
							.join("; "),
					},
				},
				400,
			);
		}
		const input: FetchTextInput = parsed.output;
		entry.host = new URL(input.url).host;

		try {
			const result = await deps.fetchText(input);
			entry.result = result.ok ? "ok" : result.error.type;
			entry.mode = result.ok ? result.mode : result.error.mode;
			finish(200);
			return c.json(result, 200);
		} catch (error) {
			entry.result = "internal_error";
			entry.mode = input.mode ?? "http";
			entry.exception = error instanceof Error ? error.name : "unknown";
			finish(500);
			return c.json({ ok: false, error: { type: "internal_error" } }, 500);
		}
	});

	app.notFound((c) => c.json({ ok: false, error: { type: "not_found" } }, 404));

	return app;
}
