import http from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HttpFetchOptions, httpGet } from "./http.ts";
import { parseCidrList, type ResolvedAddress } from "./ssrf.ts";

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };

let server: http.Server;
let port: number;
let handler: http.RequestListener;
let requests: http.IncomingMessage[];

beforeEach(async () => {
	requests = [];
	handler = (_req, res) => {
		res.statusCode = 200;
		res.end("ok");
	};
	server = http.createServer((req, res) => {
		requests.push(req);
		handler(req, res);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
});

function options(over: Partial<HttpFetchOptions> = {}): HttpFetchOptions {
	return {
		resolve: async (host) => {
			if (host.endsWith(".test")) return [PUBLIC];
			throw new Error("ENOTFOUND");
		},
		timeoutMs: 2000,
		maxBytes: 1024,
		maxRedirects: 3,
		userAgent: "chatsumi-test",
		pin: (vetted) => ({ ...vetted, address: "127.0.0.1", family: 4, port }),
		...over,
	};
}

const get = (path: string, over?: Partial<HttpFetchOptions>) =>
	httpGet(`http://example.test${path}`, options(over));

async function expectError(
	p: ReturnType<typeof httpGet>,
	type: string,
	message?: string | RegExp,
) {
	const r = await p;
	expect(r.ok).toBe(false);
	if (r.ok) return;
	expect(r.error.type).toBe(type);
	if (typeof message === "string") expect(r.error.message).toBe(message);
	if (message instanceof RegExp) expect(r.error.message).toMatch(message);
}

describe("httpGet success", () => {
	it("returns body, final url and content type, sending the expected headers", async () => {
		handler = (_req, res) => {
			res.setHeader("content-type", "text/html; charset=UTF-8");
			res.end("<p>hi</p>");
		};
		const r = await get("/a?b=1");
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.status).toBe(200);
		expect(r.value.finalUrl).toBe("http://example.test/a?b=1");
		expect(r.value.contentType).toBe("text/html; charset=UTF-8");
		expect(new TextDecoder().decode(r.value.body)).toBe("<p>hi</p>");
		const h = requests[0]?.headers;
		expect(h?.["user-agent"]).toBe("chatsumi-test");
		expect(h?.accept).toBe(
			"text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
		);
		expect(h?.["accept-language"]).toBe("ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7");
		expect(h?.["accept-encoding"]).toBe("gzip, deflate, br");
		expect(h?.host).toMatch(/^example\.test:\d+$/);
	});

	it("allows a missing content-type, plain text and xhtml", async () => {
		for (const ct of [null, "text/plain", "APPLICATION/XHTML+XML; x=y"]) {
			handler = (_req, res) => {
				if (ct) res.setHeader("content-type", ct);
				res.end("x");
			};
			expect((await get("/")).ok, String(ct)).toBe(true);
		}
	});

	it("decodes gzip and brotli", async () => {
		handler = (req, res) => {
			res.setHeader("content-type", "text/html");
			if (req.url === "/gz") {
				res.setHeader("content-encoding", "gzip");
				res.end(gzipSync("gzipped"));
			} else {
				res.setHeader("content-encoding", "br");
				res.end(brotliCompressSync("brotlied"));
			}
		};
		const gz = await get("/gz");
		const br = await get("/br");
		expect(gz.ok && new TextDecoder().decode(gz.value.body)).toBe("gzipped");
		expect(br.ok && new TextDecoder().decode(br.value.body)).toBe("brotlied");
	});

	it("follows redirects and reports the final url", async () => {
		handler = (req, res) => {
			if (req.url === "/start") {
				res.statusCode = 302;
				res.setHeader("location", "http://other.test/end");
				res.end();
			} else {
				res.end("done");
			}
		};
		const r = await get("/start");
		expect(r.ok && r.value.finalUrl).toBe("http://other.test/end");
		expect(requests.map((q) => q.url)).toEqual(["/start", "/end"]);
	});
});

describe("httpGet rejection", () => {
	it("rejects invalid and over-long urls as ssrf_blocked", async () => {
		await expectError(httpGet("not a url", options()), "ssrf_blocked");
		await expectError(
			httpGet(`http://example.test/${"a".repeat(2100)}`, options()),
			"ssrf_blocked",
		);
	});

	it("rejects blocked targets without connecting", async () => {
		for (const url of [
			"http://127.0.0.1/",
			"http://localhost/",
			"ftp://example.test/",
			"http://example.test:8080/",
			"http://u:p@example.test/",
		]) {
			await expectError(httpGet(url, options()), "ssrf_blocked");
		}
		expect(requests).toHaveLength(0);
	});

	it("rejects a mixed DNS answer", async () => {
		await expectError(
			httpGet(
				"http://mixed.test/",
				options({
					resolve: async () => [PUBLIC, { address: "10.0.0.1", family: 4 }],
				}),
			),
			"ssrf_blocked",
		);
	});

	it("rejects addresses in extra blocked CIDRs", async () => {
		await expectError(
			get("/", { extraBlocked: parseCidrList("93.184.216.0/24") }),
			"ssrf_blocked",
		);
	});

	it("maps DNS failure to network_error", async () => {
		await expectError(
			httpGet("http://nxdomain.example/", options()),
			"network_error",
		);
	});

	it("re-vets a redirect to a blocked host", async () => {
		for (const location of [
			"http://169.254.169.254/latest",
			"http://localhost/",
			"ftp://example.test/",
		]) {
			handler = (_req, res) => {
				res.statusCode = 301;
				res.setHeader("location", location);
				res.end();
			};
			await expectError(get("/"), "ssrf_blocked");
		}
		expect(requests).toHaveLength(3);
	});

	it("fails on redirect loops, missing and invalid Location", async () => {
		handler = (_req, res) => {
			res.statusCode = 302;
			res.setHeader("location", "/again");
			res.end();
		};
		await expectError(
			get("/", { maxRedirects: 2 }),
			"network_error",
			"too many redirects",
		);
		expect(requests).toHaveLength(3);

		handler = (_req, res) => {
			res.statusCode = 302;
			res.end();
		};
		await expectError(get("/"), "network_error", "redirect without location");

		handler = (_req, res) => {
			res.statusCode = 302;
			res.setHeader("location", "http://[bad");
			res.end();
		};
		await expectError(get("/"), "network_error", "invalid redirect location");
	});

	it("rejects unsupported content types before reading the body", async () => {
		handler = (_req, res) => {
			res.setHeader("content-type", "application/pdf");
			res.end("%PDF");
		};
		await expectError(get("/"), "unsupported_content_type");
	});
});

describe("httpGet size limit", () => {
	it("rejects by content-length", async () => {
		handler = (_req, res) => {
			res.setHeader("content-type", "text/html");
			res.setHeader("content-length", "5000");
			res.write("x");
			setTimeout(() => res.end("x".repeat(4999)), 50);
		};
		await expectError(get("/"), "too_large", "content-length exceeds limit");
	});

	it("rejects a streamed body without content-length", async () => {
		handler = (_req, res) => {
			res.setHeader("content-type", "text/html");
			res.write("x".repeat(600));
			setTimeout(() => res.end("x".repeat(600)), 20);
		};
		await expectError(get("/"), "too_large", "body exceeds limit");
	});

	it("rejects when the decompressed body exceeds the limit", async () => {
		const compressed = gzipSync("a".repeat(100_000));
		expect(compressed.length).toBeLessThan(1024);
		handler = (_req, res) => {
			res.setHeader("content-type", "text/html");
			res.setHeader("content-encoding", "gzip");
			res.end(compressed);
		};
		await expectError(get("/"), "too_large", "body exceeds limit");
	});

	it("accepts a body exactly at the limit", async () => {
		handler = (_req, res) => {
			res.setHeader("content-type", "text/html");
			res.end("x".repeat(1024));
		};
		const r = await get("/");
		expect(r.ok && r.value.body.length).toBe(1024);
	});
});

describe("httpGet status classification", () => {
	const cases: Array<[number, string]> = [
		[401, "auth_required"],
		[407, "auth_required"],
		[404, "not_found"],
		[410, "not_found"],
		[429, "rate_limited"],
		[403, "forbidden"],
		[503, "upstream_error"],
		[500, "upstream_error"],
		[502, "upstream_error"],
		[304, "upstream_error"],
		[418, "upstream_error"],
	];
	for (const [status, type] of cases) {
		it(`maps ${status} to ${type}`, async () => {
			handler = (_req, res) => {
				res.statusCode = status;
				res.end("body");
			};
			await expectError(get("/"), type);
		});
	}

	it("describes unexpected statuses", async () => {
		handler = (_req, res) => {
			res.statusCode = 418;
			res.end();
		};
		await expectError(get("/"), "upstream_error", "unexpected status 418");
	});

	it("detects a challenge by header on 403 and 503", async () => {
		for (const [status, header] of [
			[403, "cf-mitigated"],
			[503, "cf-chl-bypass"],
		] as const) {
			handler = (_req, res) => {
				res.statusCode = status;
				res.setHeader(header, "challenge");
				res.end("");
			};
			await expectError(get("/"), "challenge");
		}
	});

	it("detects a challenge by body markers", async () => {
		for (const marker of [
			"Please solve the CAPTCHA",
			"/cdn-cgi/challenge-platform/h/b",
			"cf-chl-opt",
			"<title>Just a moment...</title>",
		]) {
			handler = (_req, res) => {
				res.statusCode = 403;
				res.setHeader("content-type", "text/html");
				res.end(marker);
			};
			await expectError(get("/"), "challenge");
		}
	});

	it("does not treat the bare word challenge as a signal", async () => {
		handler = (_req, res) => {
			res.statusCode = 403;
			res.end("accept the challenge");
		};
		await expectError(get("/"), "forbidden");
	});

	it("treats an oversized 403 body as empty", async () => {
		handler = (_req, res) => {
			res.statusCode = 403;
			res.end(`${"x".repeat(2000)}captcha`);
		};
		await expectError(get("/"), "forbidden");
	});

	it("does not leak the url path in messages", async () => {
		handler = (_req, res) => {
			res.statusCode = 404;
			res.end();
		};
		const r = await get("/secret/path?token=1");
		expect(!r.ok && JSON.stringify(r.error)).not.toContain("secret");
	});
});

describe("httpGet network failures", () => {
	it("times out when the server never answers", async () => {
		handler = () => {};
		await expectError(get("/", { timeoutMs: 150 }), "timeout");
	});

	it("times out when the body stalls", async () => {
		handler = (_req, res) => {
			res.setHeader("content-type", "text/html");
			res.write("partial");
		};
		await expectError(get("/", { timeoutMs: 150 }), "timeout");
	});

	it("times out when DNS hangs", async () => {
		await expectError(
			get("/", { timeoutMs: 100, resolve: () => new Promise(() => {}) }),
			"timeout",
		);
	});

	it("maps connection refused to network_error", async () => {
		const closed = await new Promise<number>((resolve) => {
			const s = http.createServer();
			s.listen(0, "127.0.0.1", () => {
				const p = (s.address() as AddressInfo).port;
				s.close(() => resolve(p));
			});
		});
		await expectError(
			get("/", {
				pin: (v) => ({ ...v, address: "127.0.0.1", family: 4, port: closed }),
			}),
			"network_error",
		);
	});

	it("maps a dropped connection to network_error", async () => {
		handler = (req) => {
			req.socket.destroy();
		};
		await expectError(get("/"), "network_error");
	});
});
