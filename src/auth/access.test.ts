import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccessVerifier } from "./access.ts";

type Key = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

const teamDomain = "team.cloudflareaccess.com";
const audience = "aud-123";

let privateKey: Key;
let otherPrivateKey: Key;
let verify: ReturnType<typeof createAccessVerifier>;

function sign(
	key: Key,
	claims: { iss?: string; aud?: string; exp?: string | number } = {},
): Promise<string> {
	return new SignJWT({})
		.setProtectedHeader({ alg: "RS256", kid: "k1" })
		.setIssuer(claims.iss ?? `https://${teamDomain}`)
		.setAudience(claims.aud ?? audience)
		.setIssuedAt()
		.setExpirationTime(claims.exp ?? "5m")
		.sign(key);
}

beforeAll(async () => {
	const pair = await generateKeyPair("RS256");
	const other = await generateKeyPair("RS256");
	privateKey = pair.privateKey;
	otherPrivateKey = other.privateKey;
	const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
	verify = createAccessVerifier({
		teamDomain,
		audience,
		keySet: createLocalJWKSet({ keys: [jwk] }),
	});
});

describe("createAccessVerifier", () => {
	it("正しいトークンを受け入れる", async () => {
		expect(await verify(await sign(privateKey))).toBe(true);
	});

	it("トークンなしを拒否する", async () => {
		expect(await verify(undefined)).toBe(false);
		expect(await verify("")).toBe(false);
	});

	it("別の鍵の署名を拒否する", async () => {
		expect(await verify(await sign(otherPrivateKey))).toBe(false);
	});

	it("audience 違いを拒否する", async () => {
		expect(await verify(await sign(privateKey, { aud: "other" }))).toBe(false);
	});

	it("issuer 違いを拒否する", async () => {
		expect(
			await verify(await sign(privateKey, { iss: "https://evil.example" })),
		).toBe(false);
	});

	it("期限切れを拒否する", async () => {
		const past = Math.floor(Date.now() / 1000) - 3600;
		expect(await verify(await sign(privateKey, { exp: past }))).toBe(false);
	});

	it("teamDomain の https:// と末尾スラッシュを正規化する", async () => {
		const pair = await generateKeyPair("RS256");
		const jwk = {
			...(await exportJWK(pair.publicKey)),
			kid: "k1",
			alg: "RS256",
		};
		const normalized = createAccessVerifier({
			teamDomain: `https://${teamDomain}/`,
			audience,
			keySet: createLocalJWKSet({ keys: [jwk] }),
		});
		expect(await normalized(await sign(pair.privateKey))).toBe(true);
	});
});
