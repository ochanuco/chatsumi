import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

export type AccessVerifier = (token: string | undefined) => Promise<boolean>;

export function createAccessVerifier(options: {
	teamDomain: string;
	audience: string;
	keySet?: JWTVerifyGetKey;
}): AccessVerifier {
	const host = options.teamDomain
		.replace(/^https?:\/\//, "")
		.replace(/\/+$/, "");
	const keySet =
		options.keySet ??
		createRemoteJWKSet(new URL(`https://${host}/cdn-cgi/access/certs`));
	return async (token) => {
		if (!token) return false;
		try {
			await jwtVerify(token, keySet, {
				issuer: `https://${host}`,
				audience: options.audience,
				algorithms: ["RS256"],
			});
			return true;
		} catch {
			return false;
		}
	};
}
