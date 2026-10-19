export type FetchErrorType =
	| "ssrf_blocked"
	| "not_found"
	| "auth_required"
	| "forbidden"
	| "challenge"
	| "rate_limited"
	| "upstream_error"
	| "too_large"
	| "unsupported_content_type"
	| "timeout"
	| "network_error"
	| "browser_unavailable";

export type FetchError = { type: FetchErrorType; message: string };

export function fetchError(type: FetchErrorType, message: string): FetchError {
	return { type, message };
}
