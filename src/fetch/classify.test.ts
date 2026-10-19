import { describe, expect, it } from "vitest";
import { classifyStatus, hasChallengeSignal } from "./classify.ts";

describe("hasChallengeSignal", () => {
	it("detects headers case-insensitively", () => {
		expect(hasChallengeSignal(["CF-Mitigated"], "")).toBe(true);
		expect(hasChallengeSignal(["cf-chl-bypass"], "")).toBe(true);
		expect(hasChallengeSignal(["content-type"], "")).toBe(false);
	});

	it("detects body markers but not the bare word challenge", () => {
		expect(hasChallengeSignal([], "Solve the CAPTCHA")).toBe(true);
		expect(hasChallengeSignal([], "Just a moment...")).toBe(true);
		expect(hasChallengeSignal([], "accept the challenge")).toBe(false);
	});
});

describe("classifyStatus", () => {
	it("returns null for 2xx", () => {
		expect(classifyStatus(200, false)).toBeNull();
		expect(classifyStatus(204, true)).toBeNull();
	});

	it("maps statuses", () => {
		const type = (s: number, c = false) => classifyStatus(s, c)?.type;
		expect(type(401)).toBe("auth_required");
		expect(type(404)).toBe("not_found");
		expect(type(429)).toBe("rate_limited");
		expect(type(403)).toBe("forbidden");
		expect(type(403, true)).toBe("challenge");
		expect(type(503)).toBe("upstream_error");
		expect(type(503, true)).toBe("challenge");
		expect(type(500)).toBe("upstream_error");
		expect(type(418)).toBe("upstream_error");
	});
});
