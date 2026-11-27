import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
	type AreaMapDoc,
	AreaMapDocSchema,
	bodyTextForClassify,
	compileAreaMap,
} from "./rules.ts";

// 地名はすべて架空
const doc: AreaMapDoc = {
	miniflux_feed_ids: [7],
	default: { tag: "area:other", label: "その他" },
	areas: [
		{
			tag: "area:minato",
			label: "みなと",
			aliases: ["みなと", "湊", "ミナト台", "北分室"],
		},
		{
			tag: "area:ekimae",
			label: "駅前",
			aliases: ["本町駅", "町駅", "駅前ビル", "役所ちかく"],
		},
	],
	exclude: ["西町駅", "隣市役所"],
	routes: { "area:minato": "minato" },
};

const classify = (title: string, body = "") =>
	compileAreaMap("town", doc).classify(title, body);

describe("compileAreaMap の classify", () => {
	it("見出しの別名で地区を決める", () => {
		expect(classify("湊にパン屋ができる")).toEqual({
			tag: "area:minato",
			label: "みなと",
			alias: "湊",
		});
	});

	it("見出しで決まらなければ本文で先に出た別名を採る", () => {
		expect(classify("新しいパン屋", "本町駅から歩いて湊まで")).toMatchObject({
			tag: "area:ekimae",
			alias: "本町駅",
		});
	});

	it("見出しの一致は、本文で先に出る別名より優先する", () => {
		expect(classify("湊の話", "本町駅の話")).toMatchObject({
			tag: "area:minato",
		});
	});

	it("どれにも当たらなければ既定の地区", () => {
		expect(classify("天気の話", "雨")).toEqual({
			tag: "area:other",
			label: "その他",
			alias: null,
		});
	});

	it("除外する語は地区を決めず、次の一致を見る", () => {
		expect(classify("西町駅の近く")).toMatchObject({ tag: "area:other" });
		expect(classify("西町駅から湊へ")).toMatchObject({ tag: "area:minato" });
		expect(classify("隣市役所ちかくの店")).toMatchObject({ tag: "area:other" });
	});

	it("重なる一致は長い別名が勝つ", () => {
		expect(classify("本町駅の店")).toMatchObject({ alias: "本町駅" });
	});

	it("NFKC で全角と半角をそろえる", () => {
		const map = compileAreaMap("town", {
			...doc,
			areas: [{ tag: "area:x", label: "X", aliases: ["T-PLAZA"] }],
		});
		expect(map.classify("ＴｰＰＬＡＺＡ", "").tag).toBe("area:other");
		expect(map.classify("Ｔ-ＰＬＡＺＡにできる", "")).toMatchObject({
			tag: "area:x",
			alias: "T-PLAZA",
		});
	});

	it("正規表現の記号を含む別名も文字どおりに一致する", () => {
		const map = compileAreaMap("town", {
			...doc,
			areas: [{ tag: "area:x", label: "X", aliases: ["A.B(1)"] }],
		});
		expect(map.classify("A.B(1)", "").tag).toBe("area:x");
		expect(map.classify("AxB(1)", "").tag).toBe("area:other");
	});
});

describe("AreaMapDocSchema", () => {
	it("正しい doc を通し、省略した exclude と routes を補う", () => {
		const { exclude: _e, routes: _r, ...rest } = doc;
		const out = v.parse(AreaMapDocSchema, rest);
		expect(out.exclude).toEqual([]);
		expect(out.routes).toEqual({});
	});

	it("タグの重複、未定義のタグへの route、空の別名を拒む", () => {
		const bad = [
			{
				...doc,
				areas: [
					...doc.areas,
					{ tag: "area:other", label: "x", aliases: ["y"] },
				],
			},
			{ ...doc, routes: { "area:none": "x" } },
			{ ...doc, areas: [{ tag: "area:x", label: "X", aliases: [" "] }] },
			{ ...doc, miniflux_feed_ids: [] },
			{ ...doc, default: { tag: "Bad Tag", label: "x" } },
		];
		for (const b of bad)
			expect(v.safeParse(AreaMapDocSchema, b).success).toBe(false);
	});
});

describe("bodyTextForClassify", () => {
	it("タグを空白にし、script と style を捨て、文字参照を解き、冒頭で切る", () => {
		const html =
			"<p>湊&amp;本町</p><script>var x='本町駅'</script><style>.a{}</style><p>二段落目</p>";
		expect(bodyTextForClassify(html)).toBe("湊&本町 二段落目");
		expect(bodyTextForClassify("<p>あいうえお</p>", 3)).toBe("あいう");
	});
});
