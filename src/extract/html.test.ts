import { describe, expect, it } from "vitest";
import { extractDocument, extractPlainText } from "./html.ts";

describe("extractDocument title", () => {
	it("takes the first title, collapsed and trimmed", () => {
		const { title } = extractDocument(
			"<head><title>\n  Hello \n  World </title><title>second</title></head>",
		);
		expect(title).toBe("Hello World");
	});

	it("returns null when missing or empty", () => {
		expect(extractDocument("<p>x</p>").title).toBeNull();
		expect(extractDocument("<title>  \n </title>").title).toBeNull();
	});

	it("decodes entities", () => {
		expect(extractDocument("<title>A &amp; B</title>").title).toBe("A & B");
	});

	it("truncates to 512 chars without splitting a surrogate pair", () => {
		const long = `${"a".repeat(511)}😀tail`;
		const { title } = extractDocument(`<title>${long}</title>`);
		expect(title).toBe("a".repeat(511));
	});

	it("does not leak the title into the text", () => {
		expect(
			extractDocument("<head><title>T</title></head><body>B</body>").text,
		).toBe("B");
	});
});

describe("extractDocument text", () => {
	it("separates block elements with newlines and inline text with spaces", () => {
		const { text } = extractDocument(
			"<div>one <b>two</b></div><p>three</p><ul><li>a</li><li>b</li></ul>",
		);
		expect(text).toBe("one two\nthree\na\nb");
	});

	it("handles nested blocks and br", () => {
		const { text } = extractDocument(
			"<article><section><p>a<br>b</p></section></article>",
		);
		expect(text).toBe("a\nb");
	});

	it("separates table cells", () => {
		const { text } = extractDocument(
			"<table><tr><td>a</td><td>b</td></tr><tr><th>c</th></tr></table>",
		);
		expect(text).toBe("a\nb\nc");
	});

	it("drops script, style, noscript, template, svg, iframe, object", () => {
		const { text } = extractDocument(
			"<body>keep<script>var x='<p>no</p>'</script><style>p{}</style><noscript>ns</noscript><template><p>t</p></template><svg><text>s</text></svg><iframe>f</iframe><object>o</object>end</body>",
		);
		expect(text).toBe("keepend");
	});

	it("decodes entities", () => {
		expect(extractDocument("<p>a &lt; b &amp; &#x3042;&nbsp;c</p>").text).toBe(
			"a < b & あ c".trim(),
		);
	});

	it("collapses source whitespace into single spaces", () => {
		expect(extractDocument("<p>a\n\n   b\t c</p>").text).toBe("a b c");
	});

	it("returns an empty string for empty input", () => {
		expect(extractDocument("")).toEqual({ title: null, text: "" });
	});
});

describe("extractPlainText", () => {
	it("normalizes line endings, trailing spaces and blank runs", () => {
		expect(extractPlainText("a  \r\nb\t\r\r\r\r\nc\n\n\n\n\nd\n")).toBe(
			"a\nb\n\nc\n\nd",
		);
	});
});
