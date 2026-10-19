import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

describe("createApp", () => {
	it("healthz が ok を返す", async () => {
		const res = await createApp().request("/healthz");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});
