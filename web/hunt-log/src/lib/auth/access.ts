import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedDomain: string | null = null;

export function _resetCacheForTest() {
  cachedJWKS = null;
  cachedDomain = null;
}

function getJWKS() {
  const domain = process.env.ACCESS_TEAM_DOMAIN;
  if (!domain) throw new Error("ACCESS_TEAM_DOMAIN environment variable is required");
  if (cachedJWKS && cachedDomain === domain) return cachedJWKS;
  cachedDomain = domain;
  cachedJWKS = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
  return cachedJWKS;
}

export async function verifyAccessJwt(token: string): Promise<JWTPayload> {
  const aud = process.env.ACCESS_AUD;
  if (!aud) throw new Error("ACCESS_AUD environment variable is required");
  const jwks = getJWKS();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://${process.env.ACCESS_TEAM_DOMAIN}`,
    audience: aud,
  });
  return payload;
}
