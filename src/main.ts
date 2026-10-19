import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8080);
const server = serve({ fetch: createApp().fetch, port }, (info) => {
	console.log(`chatsumi listening on :${info.port}`);
});

// Komodo の停止・再起動で SIGTERM が来るので、受け付け中の応答を返してから閉じる
for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
