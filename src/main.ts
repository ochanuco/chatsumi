import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createD1AreaMapLoader } from "./areas/d1.ts";
import { createAreaStore } from "./areas/store.ts";
import { createAccessVerifier } from "./auth/access.ts";
import { loadConfig } from "./config.ts";
import { createFetchText } from "./fetch/fetchText.ts";
import { createSendDiscord } from "./notify/discord.ts";
import { createRouteEntries } from "./notify/route.ts";
import { createPostJson } from "./outbound/post.ts";

const config = loadConfig(process.env);
const log = (line: Record<string, unknown>) =>
	console.log(JSON.stringify(line));

let minifluxWebhook: Parameters<typeof createApp>[0]["minifluxWebhook"];
if (config.routing) {
	const post = createPostJson();
	const store = createAreaStore({
		load: createD1AreaMapLoader({
			accountId: config.routing.d1AccountId,
			databaseId: config.routing.d1DatabaseId,
			apiToken: config.routing.d1ApiToken,
			post,
		}),
		intervalMs: config.routing.refreshSeconds * 1000,
		log,
	});
	store.start();
	minifluxWebhook = {
		secret: config.routing.minifluxWebhookSecret,
		routeEntries: createRouteEntries({
			store,
			webhooks: config.routing.discordWebhooks,
			send: createSendDiscord({ post }),
			log,
		}),
	};
}

const app = createApp({
	minifluxWebhook,
	log,
	verifyAccess: createAccessVerifier({
		teamDomain: config.accessTeamDomain,
		audience: config.accessAudience,
	}),
	fetchText: createFetchText(config),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
	console.log(`chatsumi listening on :${info.port}`);
});

// Komodo の停止・再起動で SIGTERM が来るので、受け付け中の応答を返してから閉じる
for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
