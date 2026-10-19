import { describe, expect, it } from "vitest";
import {
	decodeHtmlBestEffort,
	extractCharsetFromContentType,
} from "./charset.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...arrs: Uint8Array[]) =>
	Uint8Array.from(arrs.flatMap((a) => [...a]));

// Shift_JIS の「あ」。UTF-8 として読むと置換文字になるので charset 検出の成否が分かる
function buildHtmlBytes(metaTag: string): Uint8Array {
	return concat(
		enc(`<html><head>${metaTag}</head><body>`),
		new Uint8Array([0x82, 0xa0]),
		enc("</body></html>"),
	);
}

const SJIS_NIHONGO = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
const EUCJP_NIHONGO = new Uint8Array([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]);

describe("decodeHtmlBestEffort meta sniffing", () => {
	it("detects charset when content comes before http-equiv", () => {
		const decoded = decodeHtmlBestEffort(
			buildHtmlBytes(
				'<meta content="text/html; charset=shift_jis" http-equiv="Content-Type">',
			),
		);
		expect(decoded).toContain("あ");
	});

	it("detects charset when http-equiv comes before content", () => {
		const decoded = decodeHtmlBestEffort(
			buildHtmlBytes(
				'<meta http-equiv="Content-Type" content="text/html; charset=shift_jis">',
			),
		);
		expect(decoded).toContain("あ");
	});

	it("detects <meta charset>", () => {
		const decoded = decodeHtmlBestEffort(
			buildHtmlBytes('<meta charset="shift_jis">'),
		);
		expect(decoded).toContain("あ");
	});

	it("does not mistake data-charset for a charset declaration", () => {
		const decoded = decodeHtmlBestEffort(
			buildHtmlBytes('<meta data-charset="shift_jis">'),
		);
		expect(decoded).not.toContain("あ");
		expect(decoded).toContain("�");
	});

	it("does not mistake data-http-equiv/data-content for the real attributes", () => {
		const decoded = decodeHtmlBestEffort(
			buildHtmlBytes(
				'<meta data-http-equiv="Content-Type" data-content="text/html; encoding=shift_jis">',
			),
		);
		expect(decoded).toContain("�");
	});

	it("reads the encoding of an XML declaration", () => {
		const bytes = concat(
			enc('<?xml version="1.0" encoding="Shift_JIS"?><a>'),
			SJIS_NIHONGO,
			enc("</a>"),
		);
		expect(decodeHtmlBestEffort(bytes)).toContain("日本語");
	});
});

describe("decodeHtmlBestEffort priority", () => {
	it("uses the header charset without meta", () => {
		expect(decodeHtmlBestEffort(buildHtmlBytes(""), "Shift_JIS")).toContain(
			"あ",
		);
	});

	it("prefers the header over a conflicting meta", () => {
		expect(
			decodeHtmlBestEffort(
				buildHtmlBytes('<meta charset="utf-8">'),
				"Shift_JIS",
			),
		).toContain("あ");
	});

	it("falls back to sniffing for an unsupported header label", () => {
		expect(
			decodeHtmlBestEffort(
				buildHtmlBytes('<meta charset="shift_jis">'),
				"not-a-real-charset-label",
			),
		).toContain("あ");
	});

	it("decodes Shift_JIS bytes", () => {
		expect(decodeHtmlBestEffort(SJIS_NIHONGO, "Shift_JIS")).toBe("日本語");
	});

	it("decodes EUC-JP bytes", () => {
		expect(decodeHtmlBestEffort(EUCJP_NIHONGO, "EUC-JP")).toBe("日本語");
		const withMeta = concat(enc('<meta charset="euc-jp">'), EUCJP_NIHONGO);
		expect(decodeHtmlBestEffort(withMeta)).toContain("日本語");
	});

	it("honors a UTF-8 BOM and UTF-16LE BOM over the header", () => {
		expect(
			decodeHtmlBestEffort(
				concat(new Uint8Array([0xef, 0xbb, 0xbf]), enc("日本")),
				"Shift_JIS",
			),
		).toBe("日本");
		expect(
			decodeHtmlBestEffort(
				new Uint8Array([0xff, 0xfe, 0xe5, 0x65]),
				"Shift_JIS",
			),
		).toBe("日");
	});

	it("defaults to UTF-8", () => {
		expect(decodeHtmlBestEffort(enc("日本語"))).toBe("日本語");
	});
});

describe("extractCharsetFromContentType", () => {
	it("extracts the charset parameter", () => {
		expect(extractCharsetFromContentType("text/html; charset=Shift_JIS")).toBe(
			"Shift_JIS",
		);
		expect(extractCharsetFromContentType("text/html;charset=UTF-8")).toBe(
			"UTF-8",
		);
		expect(extractCharsetFromContentType('text/html; charset="UTF-8"')).toBe(
			"UTF-8",
		);
	});

	it("returns undefined when absent", () => {
		expect(extractCharsetFromContentType("text/html")).toBeUndefined();
		expect(extractCharsetFromContentType(null)).toBeUndefined();
		expect(extractCharsetFromContentType(undefined)).toBeUndefined();
	});
});
