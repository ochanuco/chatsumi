import { Parser } from "htmlparser2";
import { truncateText } from "./truncate.ts";

const TITLE_MAX_CHARS = 512;

// 本文に現れない私用領域文字をブロック境界の目印にする
const SENTINEL = "";

const BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"body",
	"br",
	"dd",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"table",
	"td",
	"th",
	"tr",
	"ul",
]);

const SKIPPED_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"template",
	"svg",
	"head",
	"iframe",
	"object",
]);

// title が壊れた HTML で閉じられず巨大になるのを防ぐ収集上限
const TITLE_COLLECT_MAX = 4096;

export function extractDocument(html: string): {
	title: string | null;
	text: string;
} {
	const parts: string[] = [];
	let skipDepth = 0;
	let titleSeen = false;
	let inTitle = false;
	let titleBuffer = "";

	const parser = new Parser(
		{
			onopentag(name) {
				if (name === "title" && !titleSeen) {
					titleSeen = true;
					inTitle = true;
					return;
				}
				if (SKIPPED_TAGS.has(name)) {
					skipDepth++;
					return;
				}
				if (skipDepth === 0 && BLOCK_TAGS.has(name)) parts.push(SENTINEL);
			},
			onclosetag(name, isImplied) {
				if (name === "title" && inTitle) {
					inTitle = false;
					return;
				}
				if (SKIPPED_TAGS.has(name)) {
					if (skipDepth > 0) skipDepth--;
					return;
				}
				if (skipDepth === 0 && BLOCK_TAGS.has(name) && !isImplied) {
					parts.push(SENTINEL);
				}
			},
			ontext(data) {
				if (inTitle) {
					if (titleBuffer.length < TITLE_COLLECT_MAX) titleBuffer += data;
					return;
				}
				if (skipDepth === 0) parts.push(data);
			},
		},
		{ decodeEntities: true },
	);
	parser.write(html);
	parser.end();

	const normalizedTitle = titleBuffer.replace(/\s+/g, " ").trim();
	const title =
		normalizedTitle === ""
			? null
			: truncateText(normalizedTitle, TITLE_MAX_CHARS).text;
	return { title, text: normalizeExtractedText(parts) };
}

function normalizeExtractedText(parts: readonly string[]): string {
	return parts
		.join("")
		.replace(/[ \t\r\n\f]+/g, " ")
		.split(SENTINEL)
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.join("\n");
}

export function extractPlainText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
