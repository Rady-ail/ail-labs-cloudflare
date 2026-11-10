import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./http";
import { fail } from "./http";

type AccessClaims = {
  exp?: number;
  iss?: string;
  aud?: string | string[];
  email?: string;
};

type AccessJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

type CachedJwks = {
  expiresAt: number;
  keys: AccessJwk[];
};

const jwksCache = new Map<string, CachedJwks>();
const JWKS_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

function accessTeam(teamDomain: string): string {
  return teamDomain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\.cloudflareaccess\.com\/?$/i, "")
    .replace(/\/$/, "");
}

async function getJwks(team: string): Promise<AccessJwk[]> {
  const issuer = `https://${team}.cloudflareaccess.com`;
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("JWKS unavailable");

  const payload = (await response.json()) as { keys?: AccessJwk[] };
  if (!Array.isArray(payload.keys)) throw new Error("Invalid JWKS");
  jwksCache.set(issuer, { keys: payload.keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return payload.keys;
}

async function verifyAccessJwt(token: string, teamDomain: string, audience: string): Promise<string | null> {
  try {
    const team = accessTeam(teamDomain);
    if (!team) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const header = decodeJwtPart<{ alg?: string; kid?: string }>(parts[0]);
    const claims = decodeJwtPart<AccessClaims>(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return null;

    const issuer = `https://${team}.cloudflareaccess.com`;
    if (claims.iss !== issuer) return null;
    if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;

    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) return null;
    if (typeof claims.email !== "string" || claims.email.length === 0) return null;

    const jwks = await getJwks(team);
    const jwk = jwks.find((key) => key.kid === header.kid && (!key.alg || key.alg === "RS256"));
    if (!jwk) return null;

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlBytes(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    return valid ? claims.email : null;
  } catch {
    return null;
  }
}

// Batas percobaan masuk gagal per IP (best-effort per isolate): mencegah tebak kata sandi.
const failedLogins = new Map<string, { count: number; resetAt: number }>();
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_LIMIT = 10;

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const now = Date.now();
  const rec = failedLogins.get(ip);
  const blocked = Boolean(rec && rec.resetAt > now && rec.count >= FAIL_LIMIT);

  if (bearer && c.env.API_TOKEN && !blocked) {
    if (await constantTimeEqual(bearer, c.env.API_TOKEN)) {
      failedLogins.delete(ip);
      c.set("actor", "owner");
      await next();
      return;
    }
    const cur = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + FAIL_WINDOW_MS };
    cur.count += 1;
    failedLogins.set(ip, cur);
    if (failedLogins.size > 5000) failedLogins.clear();
  }
  if (blocked) return fail(c, 429, "RATE_LIMITED", "Terlalu banyak percobaan masuk. Coba lagi nanti.");

  const accessJwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (accessJwt && c.env.CF_ACCESS_TEAM_DOMAIN && c.env.CF_ACCESS_AUD) {
    const actor = await verifyAccessJwt(accessJwt, c.env.CF_ACCESS_TEAM_DOMAIN, c.env.CF_ACCESS_AUD);
    if (actor) {
      c.set("actor", actor);
      await next();
      return;
    }
  }

  return fail(c, 401, "UNAUTHORIZED", "Autentikasi diperlukan");
};
