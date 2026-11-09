import { test, expect, vi } from "vitest";
import { app } from "../src/index";

const env: any = { API_TOKEN: "s3cret-token", DATABASE_URL: "postgres://x:y@127.0.0.1:1/db", EMAIL_SEND_MODE: "dry-run",
  CF_ACCESS_TEAM_DOMAIN: "ail.cloudflareaccess.com", CF_ACCESS_AUD: "aud123" };
(app as any).get("/api/secure-jwt", (c: any) => c.json({ ok: true, actor: c.get("actor") }));
const req = (p: string, init: RequestInit = {}) => app.request(p, init, env);

const b64u = (b: ArrayBuffer | string) => {
  const s = typeof b === "string" ? btoa(b) : btoa(String.fromCharCode(...new Uint8Array(b)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function mk(claims: any, opts: { alg?: string; kid?: string; key: CryptoKey }) {
  const h = b64u(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1" })), p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
test("JWT Access: valid lolos, lainnya ditolak", async () => {
  const gen = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  const kp = await gen(); const other = await gen();
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256" };
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
  const now = Math.floor(Date.now() / 1000), iss = "https://ail.cloudflareaccess.com";
  const base = { iss, aud: ["aud123"], exp: now + 600, email: "rady@example.test" };
  const call = async (tok: string) => (await req("/api/secure-jwt", { headers: { "Cf-Access-Jwt-Assertion": tok } })).status;
  expect(await call(await mk(base, { key: kp.privateKey }))).toBe(200);
  expect(await call(await mk({ ...base, exp: now - 10 }, { key: kp.privateKey }))).toBe(401);
  expect(await call(await mk({ ...base, aud: ["lain"] }, { key: kp.privateKey }))).toBe(401);
  expect(await call(await mk({ ...base, iss: "https://evil.cloudflareaccess.com" }, { key: kp.privateKey }))).toBe(401);
  expect(await call(await mk(base, { key: kp.privateKey, alg: "HS256" }))).toBe(401);
  expect(await call(await mk(base, { key: other.privateKey }))).toBe(401);
  const good = await mk(base, { key: kp.privateKey }); const [h, p, s] = good.split(".");
  expect(await call(`${h}.${b64u(JSON.stringify({ ...base, email: "hacker@x.test" }))}.${s}`)).toBe(401);
  expect(await call(`${b64u(JSON.stringify({ alg: "none", kid: "k1" }))}.${p}.`)).toBe(401);
});
