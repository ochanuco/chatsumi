import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createAccessVerifier } from "./auth/access.ts";
import { loadConfig } from "./config.ts";
import { createFetchText } from "./fetch/fetchText.ts";

const config = loadConfig(process.env);
const app = createApp({
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
