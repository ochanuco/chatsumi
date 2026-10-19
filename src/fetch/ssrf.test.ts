import { describe, expect, it } from "vitest";
import {
	isBlockedAddress,
	isBlockedHostname,
	parseCidrList,
	type ResolvedAddress,
	vetUrl,
} from "./ssrf.ts";

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };

function resolver(map: Record<string, ResolvedAddress[]>) {
	return async (hostname: string) => {
		const found = map[hostname];
		if (found === undefined) throw new Error("ENOTFOUND");
		return found;
	};
}

describe("isBlockedAddress", () => {
	it("blocks private, loopback, link-local and metadata addresses", () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.169.254",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
			"255.255.255.255",
			"198.18.0.1",
			"::1",
			"::",
			"fe80::1",
			"fd00::1",
			"fd00:ec2::254",
			"fc00::1",
			"::ffff:127.0.0.1",
			"::ffff:7f00:1",
			"64:ff9b::7f00:1",
			"2002:7f00:1::1",
			"ff02::1",
		]) {
			expect(isBlockedAddress(ip), ip).toBe(true);
		}
	});

	it("allows public addresses", () => {
		for (const ip of [
			"93.184.216.34",
			"8.8.8.8",
			"172.32.0.1",
			"2606:4700:4700::1111",
		]) {
			expect(isBlockedAddress(ip), ip).toBe(false);
		}
	});

	it("blocks unparseable addresses", () => {
		expect(isBlockedAddress("not-an-ip")).toBe(true);
	});

	it("blocks addresses in extra CIDRs only when given", () => {
		const extra = parseCidrList("93.184.216.0/24, 2606:4700:4700::/48");
		expect(isBlockedAddress("93.184.216.34")).toBe(false);
		expect(isBlockedAddress("93.184.216.34", extra)).toBe(true);
		expect(isBlockedAddress("93.184.217.1", extra)).toBe(false);
		expect(isBlockedAddress("2606:4700:4700::1111", extra)).toBe(true);
		expect(isBlockedAddress("2606:4700:4701::1", extra)).toBe(false);
		expect(isBlockedAddress("10.0.0.1", parseCidrList(""))).toBe(true);
	});
});

describe("parseCidrList", () => {
	it("rejects malformed lists", () => {
		for (const bad of [
			"10.0.0.0",
			"10.0.0.0/33",
			"abc/8",
			"10.0.0.0/8/8",
			"::/129",
			"10.0.0.0/-1",
		]) {
			expect(() => parseCidrList(bad), bad).toThrow(/invalid CIDR/);
		}
	});
});

describe("isBlockedHostname", () => {
	it("blocks metadata and local hostnames", () => {
		for (const h of [
			"localhost",
			"foo.localhost",
			"metadata.google.internal",
			"metadata.google.internal.",
			"svc.internal",
			"printer.local",
		]) {
			expect(isBlockedHostname(h), h).toBe(true);
		}
		expect(isBlockedHostname("example.com")).toBe(false);
	});
});

describe("vetUrl", () => {
	const resolve = resolver({
		"example.test": [PUBLIC],
		"mixed.test": [PUBLIC, { address: "10.0.0.5", family: 4 }],
		"v6only.test": [{ address: "2606:4700:4700::1111", family: 6 }],
		"dual.test": [{ address: "2606:4700:4700::1111", family: 6 }, PUBLIC],
		"empty.test": [],
	});

	async function vet(url: string) {
		return vetUrl(new URL(url), { resolve });
	}

	it("returns the resolved public address", async () => {
		expect(await vet("https://example.test/path")).toEqual({
			ok: true,
			value: PUBLIC,
		});
	});

	it("prefers IPv4 but accepts IPv6 only", async () => {
		const dual = await vet("http://dual.test/");
		expect(dual.ok && dual.value).toEqual(PUBLIC);
		const v6 = await vet("http://v6only.test/");
		expect(v6.ok && v6.value.family).toBe(6);
	});

	it("rejects with ssrf_blocked", async () => {
		for (const url of [
			"ftp://example.test/",
			"file:///etc/passwd",
			"http://user:pw@example.test/",
			"http://example.test:8080/",
			"http://example.test:22/",
			"http://localhost/",
			"http://foo.internal/",
			"http://metadata.google.internal/",
			"http://127.0.0.1/",
			"http://[::1]/",
			"http://169.254.169.254/",
			"http://2130706433/",
			"http://0x7f.1/",
			"http://mixed.test/",
		]) {
			const r = await vet(url);
			expect(r.ok, url).toBe(false);
			if (!r.ok) expect(r.error.type, url).toBe("ssrf_blocked");
		}
	});

	it("rejects a mixed DNS answer containing a blocked address", async () => {
		const r = await vet("http://mixed.test/");
		expect(!r.ok && r.error.message).toBe("resolved address not allowed");
	});

	it("applies extra blocked CIDRs", async () => {
		const r = await vetUrl(new URL("http://example.test/"), {
			resolve,
			extraBlocked: parseCidrList("93.184.216.0/24"),
		});
		expect(!r.ok && r.error.type).toBe("ssrf_blocked");
	});

	it("maps DNS failure and empty answers to network_error", async () => {
		for (const url of ["http://nxdomain.test/", "http://empty.test/"]) {
			const r = await vet(url);
			expect(r.ok, url).toBe(false);
			if (!r.ok) expect(r.error.type, url).toBe("network_error");
		}
	});

	it("allows explicit default ports", async () => {
		expect((await vet("http://example.test:80/")).ok).toBe(true);
		expect((await vet("https://example.test:443/")).ok).toBe(true);
	});
});
