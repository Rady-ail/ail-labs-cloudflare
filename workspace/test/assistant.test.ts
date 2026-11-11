import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantRoutes } from "../src/routes/assistant";
import type { Env } from "../src/env";
import type { AppEnv } from "../src/lib/http";

vi.mock("../src/lib/db", () => ({
  getSql: () => Object.assign(async () => [], { query: vi.fn() }),
}));
vi.mock("../src/lib/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
}));

const env = (over: Partial<Env> = {}): Env => ({
  DATABASE_URL: "postgres://test",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
  API_TOKEN: "token",
  EMAIL_SEND_MODE: "dry-run",
  AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ...over,
});

function createApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-test");
    c.set("actor", c.req.header("X-Test-Actor") ?? "test-actor");
    await next();
  });
  app.route("/api/assistant", assistantRoutes);
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/assistant/chat safety", () => {
  it("fails closed when the model rate limiter is missing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const e = env();
    Object.assign(e, { AI_RATE_LIMITER: undefined });
    const response = await createApp().request("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    }, e);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "RATE_LIMITER_UNAVAILABLE" },
      meta: { requestId: "request-test" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a generic 503 when the rate limiter throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const limiter: RateLimit = { limit: vi.fn(async () => { throw new Error("private binding detail"); }) };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await createApp().request("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    }, env({ AI_RATE_LIMITER: limiter }));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private binding detail");
    expect(log).toHaveBeenCalledWith("Assistant rate limiter unavailable", { requestId: "request-test" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 429 before calling the model when the actor exceeds the route limit", async () => {
    const limiter: RateLimit = { limit: vi.fn(async () => ({ success: false })) };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await createApp().request("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    }, env({ AI_RATE_LIMITER: limiter }));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(limiter.limit).toHaveBeenCalledWith({ key: JSON.stringify(["test-actor", "/api/assistant/chat"]) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized input before database or model access", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const app = createApp();
    const e = env({ OPENAI_API_KEY: "test-key" });
    const malformed = await app.request("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }, e);
    const oversized = await app.request("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x", extra: "a".repeat(20_000) }),
    }, e);

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps rate-limit buckets isolated by actor", async () => {
    const limiter: RateLimit = { limit: vi.fn(async () => ({ success: true })) };
    const app = createApp();
    const e = env({ OPENAI_API_KEY: undefined, AI_RATE_LIMITER: limiter });
    const request = (actor: string) => app.request("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Actor": actor },
      body: JSON.stringify({ message: "hello" }),
    }, e);

    expect((await request("actor-a")).status).toBe(503);
    expect((await request("actor-b")).status).toBe(503);
    expect(limiter.limit).toHaveBeenCalledWith({ key: JSON.stringify(["actor-a", "/api/assistant/chat"]) });
    expect(limiter.limit).toHaveBeenCalledWith({ key: JSON.stringify(["actor-b", "/api/assistant/chat"]) });
  });
});
