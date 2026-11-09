import { test, expect, vi } from "vitest";
import { app } from "../src/index";

const env: any = { API_TOKEN: "s3cret-token", DATABASE_URL: "postgres://x:y@127.0.0.1:1/db", EMAIL_SEND_MODE: "dry-run",
  CF_ACCESS_TEAM_DOMAIN: "ail.cloudflareaccess.com", CF_ACCESS_AUD: "aud123" };
(app as any).get("/api/secure", (c: any) => c.json({ ok: true, actor: c.get("actor") }));
(app as any).post("/api/echo", (c: any) => c.json({ ok: true }));
const req = (p: string, init: RequestInit = {}) => app.request(p, init, env);
const allowedOrigin = "https://app.ail-aesthetic-labs.my.id";

test("tanpa auth -> 401", async () => {
  const r = await req("/api/secure", { headers: { Origin: allowedOrigin } });
  expect(r.status).toBe(401);
});
test("token salah -> 401", async () => { expect((await req("/api/secure", { headers: { Authorization: "Bearer nope" } })).status).toBe(401); });
test("token benar -> 200 actor owner", async () => {
  const r = await req("/api/secure", { headers: { Authorization: "Bearer s3cret-token" } });
  expect(r.status).toBe(200); expect(((await r.json()) as any).actor).toBe("owner");
});
test("API_TOKEN kosong tidak tertembus", async () => {
  const r = await app.request("/api/secure", { headers: { Authorization: "Bearer x" } }, { ...env, API_TOKEN: "" });
  expect(r.status).toBe(401);
});
test("origin asing -> 403; origin sah -> 200; tanpa origin hanya bearer", async () => {
  const h = { Authorization: "Bearer s3cret-token", "Content-Type": "application/json" };
  expect((await req("/api/echo", { method: "POST", headers: { ...h, Origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
  expect((await req("/api/echo", { method: "POST", headers: { ...h, Origin: allowedOrigin }, body: "{}" })).status).toBe(200);
  expect((await req("/api/echo", { method: "POST", headers: h, body: "{}" })).status).toBe(200);
  expect((await req("/api/echo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
  const devResponse = await app.request("/api/echo", { method: "POST", headers: { ...h, Origin: "http://localhost:5173" }, body: "{}" }, { ...env, DEV: "1" });
  expect(devResponse.status).toBe(200);
});
test("body > 256KB -> 413", async () => {
  const big = "a".repeat(262145);
  const r = await req("/api/echo", { method: "POST", headers: { Authorization: "Bearer s3cret-token", Origin: allowedOrigin }, body: big });
  expect(r.status).toBe(413);
});
test("health: DB tak terjangkau -> 503 tanpa bocor", async () => {
  const r = await req("/api/health", { headers: { Origin: allowedOrigin } }); const t = await r.text();
  expect(r.status).toBe(503); expect(t).not.toContain("postgres");
});

test("GET tanpa Origin dengan JWT Access valid -> 200; POST tanpa Origin tanpa Bearer -> 403", async () => {
  const gen = () => crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
  const kp = await gen();
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256" };
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));

  const b64u = (value: string | ArrayBuffer) => {
    const raw = typeof value === "string" ? btoa(value) : btoa(String.fromCharCode(...new Uint8Array(value)));
    return raw.replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  };
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const p = b64u(JSON.stringify({
    iss: "https://ail.cloudflareaccess.com",
    aud: ["aud123"],
    exp: now + 600,
    email: "rady@example.test",
  }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  const token = `${h}.${p}.${b64u(signature)}`;

  const get = await req("/api/secure", { headers: { "Cf-Access-Jwt-Assertion": token } });
  expect(get.status).toBe(200);
  const post = await req("/api/echo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(post.status).toBe(403);
});
