import * as v from "valibot";
import type { LoadAreaMaps } from "./d1.ts";
import { type AreaMap, AreaMapDocSchema, compileAreaMap } from "./rules.ts";

export type AreaStore = {
	/** Miniflux の feed の ID から、その feed に当てる表を引く。まだ読めていなければ undefined */
	forMinifluxFeed: (minifluxFeedId: number) => AreaMap | undefined;
	refresh: () => Promise<void>;
	/** 読み込みを始める。起動を待たせないよう、最初の読み込みも待たない */
	start: () => void;
	stop: () => void;
};

export function createAreaStore(opts: {
	load: LoadAreaMaps;
	intervalMs: number;
	log: (line: Record<string, unknown>) => void;
}): AreaStore {
	// feed_id → 最後に読めた版。読めなかった行は前の版を残す
	let maps = new Map<string, AreaMap>();
	let byMiniflux = new Map<number, AreaMap>();
	let timer: ReturnType<typeof setInterval> | undefined;

	const index = () => {
		const next = new Map<number, AreaMap>();
		for (const map of maps.values()) {
			for (const id of map.minifluxFeedIds) {
				const taken = next.get(id);
				if (taken) {
					opts.log({
						component: "area_store",
						result: "duplicate_feed",
						minifluxFeedId: id,
						kept: taken.feedId,
						skipped: map.feedId,
					});
					continue;
				}
				next.set(id, map);
			}
		}
		byMiniflux = next;
	};

	const refresh = async () => {
		const loaded = await opts.load();
		if (!loaded.ok) {
			opts.log({
				component: "area_store",
				result: "load_failed",
				message: loaded.error,
			});
			return;
		}
		const next = new Map<string, AreaMap>();
		for (const row of loaded.value) {
			let json: unknown;
			try {
				json = JSON.parse(row.doc);
			} catch {
				json = undefined;
			}
			const parsed = v.safeParse(AreaMapDocSchema, json);
			if (parsed.success) {
				next.set(row.feed_id, compileAreaMap(row.feed_id, parsed.output));
				continue;
			}
			const previous = maps.get(row.feed_id);
			if (previous) next.set(row.feed_id, previous);
			opts.log({
				component: "area_store",
				result: "invalid_doc",
				feedId: row.feed_id,
				keptPrevious: previous !== undefined,
				issues: parsed.issues
					.map((i) => `${v.getDotPath(i) ?? "doc"}: ${i.message}`)
					.join("; "),
			});
		}
		maps = next;
		index();
		opts.log({ component: "area_store", result: "loaded", feeds: maps.size });
	};

	const safeRefresh = () => {
		refresh().catch((e: unknown) => {
			opts.log({
				component: "area_store",
				result: "load_failed",
				message: e instanceof Error ? e.message : "unknown",
			});
		});
	};

	return {
		forMinifluxFeed: (id) => byMiniflux.get(id),
		refresh,
		start: () => {
			if (timer) return;
			safeRefresh();
			timer = setInterval(safeRefresh, opts.intervalMs);
			timer.unref();
		},
		stop: () => {
			if (timer) clearInterval(timer);
			timer = undefined;
		},
	};
}
