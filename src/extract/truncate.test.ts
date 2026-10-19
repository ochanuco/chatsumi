import { describe, expect, it } from "vitest";
import { truncateText } from "./truncate.ts";

describe("truncateText", () => {
	it("returns the text untouched within the limit", () => {
		expect(truncateText("abc", 3)).toEqual({ text: "abc", truncated: false });
	});

	it("truncates by UTF-16 code units", () => {
		expect(truncateText("abcdef", 4)).toEqual({
			text: "abcd",
			truncated: true,
		});
	});

	it("never splits a surrogate pair", () => {
		expect(truncateText("ab😀cd", 3)).toEqual({ text: "ab", truncated: true });
		expect(truncateText("ab😀cd", 4)).toEqual({
			text: "ab😀",
			truncated: true,
		});
	});
});
