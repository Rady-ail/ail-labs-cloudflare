import { test, expect } from "vitest";
import { app } from "../src/index";

const env: any = { API_TOKEN: "s3cret-token", DATABASE_URL: "postgres://x:y@127.0.0.1:1/db", EMAIL_SEND_MODE: "dry-run",
  CF_ACCESS_TEAM_DOMAIN: "ail.cloudflareaccess.com", CF_ACCESS_AUD: "aud123" };
(app as any).get("/api/secure", (c: any) => c.json({ ok: true, actor: c.get("actor") }));
(app as any).post("/api/echo", (c: any) => c.json({ ok: true }));
const req = (p: string, init: RequestInit = {}) => app.request(p, init, env);

test("tanpa auth -> 401", async () => { expect((await req("/api/secure")).status).toBe(401); });
test("token salah -> 401", async () => { expect((await req("/api/secure", { headers: { Authorization: "Bearer nope" } })).status).toBe(401); });
test("token benar -> 200 actor owner", async () => {
  const r = await req("/api/secure", { headers: { Authorization: "Bearer s3cret-token" } });
  expect(r.status).toBe(200); expect(((await r.json()) as any).actor).toBe("owner");
});
test("API_TOKEN kosong tidak tertembus", async () => {
  const r = await app.request("/api/secure", { headers: { Authorization: "Bearer x" } }, { ...env, API_TOKEN: "" });
  expect(r.status).toBe(401);
});
test("origin asing POST -> 403; origin sah lolos", async () => {
  const h = { Authorization: "Bearer s3cret-token", "Content-Type": "application/json" };
  expect((await req("/api/echo", { method: "POST", headers: { ...h, Origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
  expect((await req("/api/echo", { method: "POST", headers: { ...h, Origin: "https://app.ail-aesthetic-labs.my.id" }, body: "{}" })).status).toBe(200);
});
test("body > 256KB -> 413", async () => {
  const big = "a".repeat(262145);
  const r = await req("/api/echo", { method: "POST", headers: { Authorization: "Bearer s3cret-token", Origin: "https://app.ail-aesthetic-labs.my.id", "Content-Length": String(big.length) }, body: big });
  expect(r.status).toBe(413);
});
test("health: DB tak terjangkau -> 503 tanpa bocor", async () => {
  const r = await req("/api/health"); const t = await r.text();
  expect(r.status).toBe(503); expect(t).not.toContain("postgres");
});
