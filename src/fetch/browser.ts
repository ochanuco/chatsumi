import {
	type Browser,
	type BrowserContext,
	chromium,
	type Response,
} from "playwright-core";
import { err, ok, type Result } from "../result.ts";
import { classifyStatus, hasChallengeSignal } from "./classify.ts";
import { type FetchError, fetchError } from "./errors.ts";

export type BrowserFetchOptions = {
	cdpUrl: string;
	timeoutMs: number;
	maxConcurrency: number;
	vet: (url: URL) => Promise<Result<unknown, FetchError>>;
	isBlockedAddress: (address: string) => boolean;
	connect?: (cdpUrl: string, timeoutMs: number) => Promise<Browser>;
};

export type BrowserPage = { status: number; finalUrl: string; html: string };

export type BrowserFetcher = (
	url: string,
) => Promise<Result<BrowserPage, FetchError>>;

const SETTLE_MS = 3_000;
const CHALLENGE_WAIT_MS = 10_000;

export function createBrowserFetcher(
	opts: BrowserFetchOptions,
): BrowserFetcher {
	const connect =
		opts.connect ??
		((cdpUrl: string, timeoutMs: number) =>
			chromium.connectOverCDP(cdpUrl, { timeout: timeoutMs }));
	const limit = createLimiter(opts.maxConcurrency);
	return (url) => limit(() => fetchWithBrowser(url, opts, connect));
}

async function fetchWithBrowser(
	url: string,
	opts: BrowserFetchOptions,
	connect: (cdpUrl: string, timeoutMs: number) => Promise<Browser>,
): Promise<Result<BrowserPage, FetchError>> {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return err(fetchError("ssrf_blocked", "invalid url"));
	}
	const vetted = await opts.vet(target);
	if (!vetted.ok) return vetted;

	const startedAt = Date.now();
	let browser: Browser;
	try {
		browser = await connect(opts.cdpUrl, opts.timeoutMs);
	} catch {
		return err(fetchError("browser_unavailable", "cannot connect to browser"));
	}

	let timedOut = false;
	// 期限が来たらブラウザごと閉じ、待っている Playwright の呼び出しをすべて失敗させる
	const timer = setTimeout(() => {
		timedOut = true;
		void browser.close().catch(() => undefined);
	}, opts.timeoutMs);
	const guard = createGuard(opts);

	try {
		const context = await browser.newContext({
			serviceWorkers: "block",
			userAgent: desktopUserAgent(browser.version()),
			locale: "ja-JP",
		});
		await guard.install(context);

		const page = await context.newPage();
		let mainResponse: Response | null = null;
		page.on("response", (res) => {
			if (
				res.request().isNavigationRequest() &&
				res.frame() === page.mainFrame()
			) {
				mainResponse = res;
			}
		});

		await page.goto(target.href, {
			waitUntil: "domcontentloaded",
			timeout: opts.timeoutMs,
		});
		await settle(page);

		let result = await readPage(page, mainResponse);
		if (!result.ok && result.error.type === "challenge") {
			// JavaScript の challenge は数秒で解けて本来のページへ移ることがあるので、一度だけ待つ
			const remaining = opts.timeoutMs - (Date.now() - startedAt) - SETTLE_MS;
			if (remaining > 0) {
				await page
					.waitForEvent("framenavigated", {
						predicate: (frame) => frame === page.mainFrame(),
						timeout: Math.min(CHALLENGE_WAIT_MS, remaining),
					})
					.then(() => page.waitForLoadState("domcontentloaded"))
					.then(() => settle(page))
					.catch(() => undefined);
				result = await readPage(page, mainResponse);
			}
		}

		const blocked = await guard.blocked();
		if (blocked) return err(blocked);
		return result;
	} catch {
		const blocked = await guard.blocked();
		if (blocked) return err(blocked);
		if (timedOut) return err(fetchError("timeout", "browser timeout exceeded"));
		return err(fetchError("network_error", "browser navigation failed"));
	} finally {
		clearTimeout(timer);
		await browser.close().catch(() => undefined);
	}
}

/**
 * ページが出すリクエストを検査する。
 * route はリダイレクトの先と、検査の後にブラウザが引き直した DNS の結果を止められない。
 * そのため応答の接続先アドレスを後から確かめ、拒否範囲に届いていたら取得結果ごと捨てる。
 */
function createGuard(opts: BrowserFetchOptions) {
	let violation: FetchError | null = null;
	const pending: Promise<void>[] = [];

	return {
		async install(context: BrowserContext): Promise<void> {
			await context.route("**/*", async (route) => {
				let url: URL;
				try {
					url = new URL(route.request().url());
				} catch {
					await route.abort("blockedbyclient");
					return;
				}
				if (url.protocol === "data:" || url.protocol === "blob:") {
					await route.continue();
					return;
				}
				const vetted = await opts.vet(url);
				if (vetted.ok) {
					await route.continue();
					return;
				}
				// サブリソースは止めれば済むので、ページの移動先が弾かれたときだけ取得を失敗にする
				const request = route.request();
				if (
					request.isNavigationRequest() &&
					request.frame().parentFrame() === null
				) {
					violation ??= vetted.error;
				}
				await route.abort("blockedbyclient");
			});
			await context.routeWebSocket(/.*/, (ws) => ws.close());
			context.on("response", (res) => {
				pending.push(
					res
						.serverAddr()
						.then((addr) => {
							if (!addr) return;
							const address = addr.ipAddress.replace(/^\[(.*)\]$/, "$1");
							if (opts.isBlockedAddress(address)) {
								violation ??= fetchError(
									"ssrf_blocked",
									"browser reached a blocked address",
								);
							}
						})
						.catch(() => undefined),
				);
			});
		},
		async blocked(): Promise<FetchError | null> {
			await Promise.all(pending);
			return violation;
		},
	};
}

async function settle(page: {
	waitForLoadState: (
		state: "networkidle",
		options: { timeout: number },
	) => Promise<void>;
}): Promise<void> {
	await page
		.waitForLoadState("networkidle", { timeout: SETTLE_MS })
		.catch(() => undefined);
}

async function readPage(
	page: { content: () => Promise<string>; url: () => string },
	response: Response | null,
): Promise<Result<BrowserPage, FetchError>> {
	if (!response) return err(fetchError("network_error", "no main response"));
	const html = await page.content();
	const status = response.status();
	const challenged =
		(status === 403 || status === 503) &&
		hasChallengeSignal(Object.keys(await response.allHeaders()), html);
	const classified = classifyStatus(status, challenged);
	if (classified) return err(classified);
	return ok({ status, finalUrl: page.url(), html });
}

// HeadlessChrome を名乗ると bot として弾くサイトがあるため、通常の Chrome の UA にそろえる
function desktopUserAgent(version: string): string {
	const major = version.split(".")[0] ?? "0";
	return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function createLimiter(max: number) {
	let active = 0;
	const queue: (() => void)[] = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (active >= max)
			await new Promise<void>((resolve) => queue.push(resolve));
		active++;
		try {
			return await task();
		} finally {
			active--;
			queue.shift()?.();
		}
	};
}
