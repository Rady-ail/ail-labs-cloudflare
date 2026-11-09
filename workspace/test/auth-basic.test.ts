import { test, expect } from "vitest";
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
  const r = await req("/api/health"); const t = await r.text();
  expect(r.status).toBe(503); expect(t).not.toContain("postgres");
});
