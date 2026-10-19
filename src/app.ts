import { Hono } from "hono";
import * as v from "valibot";
import {
	type FetchText,
	type FetchTextInput,
	FetchTextInputSchema,
} from "./api.ts";

export type AppDeps = {
	verifyAccess: (token: string | undefined) => Promise<boolean>;
	fetchText: FetchText;
	log?: (line: Record<string, unknown>) => void;
};

export function createApp(deps: AppDeps): Hono {
	const log =
		deps.log ??
		((line: Record<string, unknown>) => console.log(JSON.stringify(line)));
	const app = new Hono();

	app.get("/healthz", (c) => c.json({ ok: true }));

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
