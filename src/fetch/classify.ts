import { type FetchError, fetchError } from "./errors.ts";

const CHALLENGE_BODY_MARKERS = [
	"captcha",
	"challenge-platform",
	"cf-chl",
	"just a moment...",
];

export function hasChallengeSignal(
	headerNames: Iterable<string>,
	body: string,
): boolean {
	for (const name of headerNames) {
		const lower = name.toLowerCase();
		if (lower === "cf-mitigated" || lower.startsWith("cf-chl-")) return true;
	}
	const lowerBody = body.toLowerCase();
	return CHALLENGE_BODY_MARKERS.some((marker) => lowerBody.includes(marker));
}

/** 2xx なら null。challenge の判定は 403 と 503 だけに効かせる */
export function classifyStatus(
	status: number,
	challenged: boolean,
): FetchError | null {
	if (status >= 200 && status < 300) return null;
	if (status === 401 || status === 407)
		return fetchError("auth_required", `status ${status}`);
	if (status === 404 || status === 410)
		return fetchError("not_found", `status ${status}`);
	if (status === 429) return fetchError("rate_limited", "status 429");
	if ((status === 403 || status === 503) && challenged)
		return fetchError("challenge", `status ${status}`);
	if (status === 403) return fetchError("forbidden", "status 403");
	if (status >= 500) return fetchError("upstream_error", `status ${status}`);
	return fetchError("upstream_error", `unexpected status ${status}`);
}
