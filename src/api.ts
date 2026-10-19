import * as v from "valibot";
import type { FetchErrorType } from "./fetch/errors.ts";

export type FetchMode = "http" | "browser";

export type FetchTextInput = { url: string; mode?: FetchMode };

export type FetchTextSuccess = {
	ok: true;
	title: string | null;
	text: string;
	truncated: boolean;
	finalUrl: string;
	mode: FetchMode;
	status: number;
};

export type FetchTextFailure = {
	ok: false;
	error: { type: FetchErrorType; message: string; mode: FetchMode };
};

export type FetchTextResponse = FetchTextSuccess | FetchTextFailure;

export type FetchText = (input: FetchTextInput) => Promise<FetchTextResponse>;

function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

export const FetchTextInputSchema = v.object({
	url: v.pipe(
		v.string(),
		v.maxLength(2048),
		v.check(isHttpUrl, "url must be an http or https URL"),
	),
	mode: v.optional(v.picklist(["http", "browser"])),
});
