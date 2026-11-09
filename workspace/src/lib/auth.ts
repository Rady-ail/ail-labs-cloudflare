import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./http";

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

interface AccessJwtHeader { alg?: string; kid?: string }
interface AccessJwtPayload { exp?: number; iss?: string; aud?: string | string[]; email?: string }
interface JwksResponse { keys: JsonWebKey[] }

const jwksCache = new Map<string, { keys: JsonWebKey[]; expiresAt: number }>();

export async function verifyCloudflareAccessJwt(token: string, teamDomain: string, audience: string): Promise<string | null> {
  try {
    const team = teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as AccessJwtHeader;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as AccessJwtPayload;
    if (header.alg !== "RS256" || !header.kid || !payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (payload.iss !== `https://${team}`) return null;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return null;
    let cached = jwksCache.get(team);
    if (!cached || cached.expiresAt <= Date.now()) {
      const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
      if (!response.ok) return null;
      const document = await response.json() as JwksResponse;
      cached = { keys: document.keys, expiresAt: Date.now() + 5 * 60 * 1000 };
      jwksCache.set(team, cached);
    }
    const jwk = cached.keys.find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    return signatureValid && typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authorization = c.req.header("Authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (bearer && c.env.API_TOKEN && constantTimeEqual(bearer, c.env.API_TOKEN)) {
    c.set("actor", "owner");
    await next();
    return;
  }
  const jwt = c.req.header("Cf-Access-Jwt-Assertion") ?? bearer;
  if (jwt && c.env.CF_ACCESS_TEAM_DOMAIN && c.env.CF_ACCESS_AUD) {
    const actor = await verifyCloudflareAccessJwt(jwt, c.env.CF_ACCESS_TEAM_DOMAIN, c.env.CF_ACCESS_AUD);
    if (actor) {
      c.set("actor", actor);
      await next();
      return;
    }
  }
  return c.json({ error: { code: "UNAUTHORIZED", message: "Autentikasi diperlukan" }, meta: { requestId: c.get("requestId") } }, 401);
};

export { constantTimeEqual };
