import { bodyTextForClassify } from "../areas/rules.ts";
import type { AreaStore } from "../areas/store.ts";
import { formatEntryMessage, type SendDiscord } from "./discord.ts";
import type { MinifluxEntry } from "./miniflux.ts";

export type RouteEntries = (entries: MinifluxEntry[]) => Promise<void>;

/** 新着を地区に振り分け、地区ごとの通知先に 1 件ずつ送る。表の無い feed と、送り先の無い地区は送らない */
export function createRouteEntries(opts: {
	store: Pick<AreaStore, "forMinifluxFeed">;
	webhooks: ReadonlyMap<string, string>;
	send: SendDiscord;
	log: (line: Record<string, unknown>) => void;
}): RouteEntries {
	return async (entries) => {
		for (const entry of entries) {
			const map = opts.store.forMinifluxFeed(entry.feed_id);
			if (!map) continue;
			const area = map.classify(
				entry.title,
				bodyTextForClassify(entry.content),
			);
			const line = {
				component: "route",
				feedId: map.feedId,
				entryId: entry.id,
				tag: area.tag,
				alias: area.alias,
			};
			const dest = map.routes.get(area.tag);
			if (dest === undefined) {
				opts.log({ ...line, result: "no_route" });
				continue;
			}
			const webhookUrl = opts.webhooks.get(dest);
			if (webhookUrl === undefined) {
				opts.log({ ...line, dest, result: "unknown_webhook" });
				continue;
			}
			const sent = await opts.send(
				webhookUrl,
				formatEntryMessage(area.label, entry.title, entry.url),
			);
			opts.log({
				...line,
				dest,
				result: sent.ok ? "sent" : "send_failed",
				...(sent.ok ? {} : { message: sent.error }),
			});
		}
	};
}
