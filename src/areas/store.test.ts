import { describe, expect, it } from "vitest";
import { err, ok } from "../result.ts";
import type { AreaMapRow, LoadAreaMaps } from "./d1.ts";
import { createAreaStore } from "./store.ts";

const doc = (feedIds: number[], alias = "湊") =>
	JSON.stringify({
		miniflux_feed_ids: feedIds,
		default: { tag: "area:other", label: "その他" },
		areas: [{ tag: "area:minato", label: "みなと", aliases: [alias] }],
	});

function setup(
	responses: Array<
		ReturnType<LoadAreaMaps> extends Promise<infer R> ? R : never
	>,
) {
	const logs: Record<string, unknown>[] = [];
	let i = 0;
	const store = createAreaStore({
		load: async () => responses[Math.min(i++, responses.length - 1)] ?? ok([]),
		intervalMs: 60_000,
		log: (line) => logs.push(line),
	});
	return { store, logs };
}

const rows = (...r: AreaMapRow[]) => ok(r);

describe("createAreaStore", () => {
	it("読む前は表が無い", () => {
		expect(setup([]).store.forMinifluxFeed(1)).toBeUndefined();
	});

	it("Miniflux の feed の ID から表を引く", async () => {
		const { store } = setup([rows({ feed_id: "town", doc: doc([1, 2]) })]);
		await store.refresh();
		expect(store.forMinifluxFeed(2)?.feedId).toBe("town");
		expect(store.forMinifluxFeed(3)).toBeUndefined();
	});

	it("読み込みに失敗したら前の版を使い続ける", async () => {
		const { store, logs } = setup([
			rows({ feed_id: "town", doc: doc([1]) }),
			err("d1 status 500"),
		]);
		await store.refresh();
		await store.refresh();
		expect(store.forMinifluxFeed(1)?.feedId).toBe("town");
		expect(logs.at(-1)).toMatchObject({ result: "load_failed" });
	});

	it("形の合わない行は、その feed の前の版を残す", async () => {
		const { store, logs } = setup([
			rows({ feed_id: "town", doc: doc([1], "湊") }),
			rows({ feed_id: "town", doc: "{not json" }),
		]);
		await store.refresh();
		await store.refresh();
		expect(store.forMinifluxFeed(1)?.classify("湊", "").tag).toBe(
			"area:minato",
		);
		expect(logs).toContainEqual(
			expect.objectContaining({ result: "invalid_doc", keptPrevious: true }),
		);
	});

	it("消えた行の表は外す", async () => {
		const { store } = setup([rows({ feed_id: "town", doc: doc([1]) }), rows()]);
		await store.refresh();
		await store.refresh();
		expect(store.forMinifluxFeed(1)).toBeUndefined();
	});

	it("同じ Miniflux の feed を 2 つの表が持てば、先の行を採る", async () => {
		const { store, logs } = setup([
			rows({ feed_id: "a", doc: doc([1]) }, { feed_id: "b", doc: doc([1]) }),
		]);
		await store.refresh();
		expect(store.forMinifluxFeed(1)?.feedId).toBe("a");
		expect(logs).toContainEqual(
			expect.objectContaining({ result: "duplicate_feed" }),
		);
	});

	it("start は最初の読み込みを待たず、例外も外に出さない", async () => {
		const logs: Record<string, unknown>[] = [];
		const store = createAreaStore({
			load: async () => {
				throw new Error("boom");
			},
			intervalMs: 60_000,
			log: (line) => logs.push(line),
		});
		store.start();
		await new Promise((r) => setTimeout(r, 0));
		store.stop();
		expect(logs).toContainEqual(
			expect.objectContaining({ result: "load_failed", message: "boom" }),
		);
	});
});
