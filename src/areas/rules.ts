import { Parser } from "htmlparser2";
import * as v from "valibot";

const TagSchema = v.pipe(
	v.string(),
	v.regex(/^[a-z0-9][a-z0-9:_-]{0,63}$/, "tag must be lowercase [a-z0-9:_-]"),
);
const NonEmpty = v.pipe(v.string(), v.trim(), v.minLength(1));

/** D1 の `area_maps.doc` の形。D1 は chatsumi の外から書かれるので、読むたびに確かめる */
export const AreaMapDocSchema = v.pipe(
	v.object({
		miniflux_feed_ids: v.pipe(
			v.array(v.pipe(v.number(), v.integer(), v.minValue(1))),
			v.minLength(1),
		),
		default: v.object({ tag: TagSchema, label: NonEmpty }),
		areas: v.array(
			v.object({
				tag: TagSchema,
				label: NonEmpty,
				aliases: v.pipe(v.array(NonEmpty), v.minLength(1)),
			}),
		),
		exclude: v.optional(v.array(NonEmpty), []),
		routes: v.optional(v.record(TagSchema, NonEmpty), {}),
	}),
	v.check((doc) => {
		const tags = [doc.default.tag, ...doc.areas.map((a) => a.tag)];
		return new Set(tags).size === tags.length;
	}, "tags must be unique"),
	v.check((doc) => {
		const tags = new Set([doc.default.tag, ...doc.areas.map((a) => a.tag)]);
		return Object.keys(doc.routes).every((t) => tags.has(t));
	}, "routes must refer to a defined tag"),
);

export type AreaMapDoc = v.InferOutput<typeof AreaMapDocSchema>;

export type Area = { tag: string; label: string };

export type AreaMap = {
	feedId: string;
	minifluxFeedIds: number[];
	defaultArea: Area;
	/** 地区のタグ → 通知先の名前 */
	routes: ReadonlyMap<string, string>;
	classify: (title: string, body: string) => Classification;
};

export type Classification = Area & { alias: string | null };

const normalize = (s: string) => s.normalize("NFKC");

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileAreaMap(feedId: string, doc: AreaMapDoc): AreaMap {
	// null は除外する語。地区を決めず、その位置の文字を消費するだけ
	const areaOf = new Map<string, Area | null>();
	for (const word of doc.exclude) areaOf.set(normalize(word), null);
	for (const area of doc.areas) {
		for (const alias of area.aliases) {
			areaOf.set(normalize(alias), { tag: area.tag, label: area.label });
		}
	}
	// 長い順に並べると、同じ位置から始まる一致では長い語が勝つ。前の位置から始まる語は先に消費される
	const words = [...areaOf.keys()].sort((a, b) => b.length - a.length);
	const pattern =
		words.length > 0
			? new RegExp(words.map(escapeRegExp).join("|"), "g")
			: null;

	const firstHit = (text: string): Classification | null => {
		if (pattern === null) return null;
		for (const m of normalize(text).matchAll(pattern)) {
			const area = areaOf.get(m[0]);
			if (area) return { ...area, alias: m[0] };
		}
		return null;
	};

	const defaultArea = { tag: doc.default.tag, label: doc.default.label };
	return {
		feedId,
		minifluxFeedIds: doc.miniflux_feed_ids,
		defaultArea,
		routes: new Map(Object.entries(doc.routes)),
		// 見出しで決まればそれを採る。見出しの地名のほうが、本文の途中に出る地名より記事の主題に近い
		classify: (title, body) =>
			firstHit(title) ?? firstHit(body) ?? { ...defaultArea, alias: null },
	};
}

/** 判定に使う本文の長さ。冒頭だけを見るほうが、関連記事の欄などに出る地名を拾わずに済む */
export const BODY_CHARS = 300;

/** タグを空白に置き換え、文字参照を解き、空白を詰めて冒頭を返す */
export function bodyTextForClassify(html: string, chars = BODY_CHARS): string {
	const parts: string[] = [];
	let skipDepth = 0;
	const parser = new Parser({
		onopentagname(name) {
			if (name === "script" || name === "style") skipDepth++;
			parts.push(" ");
		},
		onclosetag(name) {
			if ((name === "script" || name === "style") && skipDepth > 0) skipDepth--;
			parts.push(" ");
		},
		ontext(text) {
			if (skipDepth === 0) parts.push(text);
		},
	});
	parser.write(html);
	parser.end();
	return parts.join("").replace(/\s+/g, " ").trim().slice(0, chars);
}
