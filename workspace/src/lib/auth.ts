import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./http";
import { fail } from "./http";

type Claims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  email?: string;
};

type AccessJwk = JsonWebKey & { kid?: string; alg?: string };
const jwksCache = new Map<string, { expiresAt: number; keys: AccessJwk[] }>();
const encoder = new TextEncoder();

function decodePart<T>(value: string): T {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0)))) as T;
}

function teamName(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\.cloudflareaccess\.com\/?$/i, "").replace(/\/$/, "");
}

async function equalConstantTime(a: string, b: string): Promise<boolean> {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const length = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < length; i += 1) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function loadJwks(issuer: string): Promise<AccessJwk[]> {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Access JWKS unavailable");
  const payload = await response.json() as { keys?: AccessJwk[] };
  if (!Array.isArray(payload.keys)) throw new Error("Invalid Access JWKS");
  jwksCache.set(issuer, { keys: payload.keys, expiresAt: Date.now() + 600_000 });
  return payload.keys;
}

async function verifyAccess(token: string, domain: string, audience: string): Promise<string | null> {
  try {
    const issuer = `https://${teamName(domain)}.cloudflareaccess.com`;
    const parts = token.split(".");
    if (parts.length !== 3 || issuer === "https://.cloudflareaccess.com") return null;
    const header = decodePart<{ alg?: string; kid?: string }>(parts[0]);
    const claims = decodePart<Claims>(parts[1]);
    if (header.alg !== "RS256" || !header.kid || claims.iss !== issuer) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now)) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(audience) || typeof claims.email !== "string" || !claims.email) return null;
    const jwk = (await loadJwks(issuer)).find(k => k.kid === header.kid && (!k.alg || k.alg === "RS256"));
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[2].length / 4) * 4, "=")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, encoder.encode(`${parts[0]}.${parts[1]}`));
    return valid ? claims.email : null;
  } catch {
    return null;
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path === "/api/email/webhook/resend") return next();

  const accessJwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (accessJwt && c.env.CF_ACCESS_TEAM_DOMAIN && c.env.CF_ACCESS_AUD) {
    const actor = await verifyAccess(accessJwt, c.env.CF_ACCESS_TEAM_DOMAIN, c.env.CF_ACCESS_AUD);
    if (actor) {
      c.set("actor", actor);
      return next();
    }
  }

  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && c.env.API_TOKEN && await equalConstantTime(bearer, c.env.API_TOKEN)) {
    c.set("actor", "owner");
    return next();
  }
  return fail(c, 401, "UNAUTHORIZED", "Autentikasi diperlukan");
};
