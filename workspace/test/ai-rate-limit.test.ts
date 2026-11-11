import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRoutes } from "../src/routes/ai";
import type { Env } from "../src/env";
import type { AppEnv } from "../src/lib/http";

vi.mock("../src/lib/db", () => ({
  getSql: () => Object.assign(async () => [], { query: vi.fn() }),
}));
vi.mock("../src/lib/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
}));

const env = (AI_RATE_LIMITER: RateLimit): Env => ({
  DATABASE_URL: "",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
  API_TOKEN: "",
  EMAIL_SEND_MODE: "dry-run",
  OPENAI_API_KEY: "test-key",
  AI_RATE_LIMITER,
});

function createTestApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-test");
    c.set("actor", c.req.header("X-Test-Actor") ?? "test-actor");
    await next();
  });
  app.route("/api/ai", aiRoutes);
  return app;
}

function makeLimiter(limit: number) {
  const counts = new Map<string, number>();
  const binding: RateLimit = {
    limit: vi.fn(async ({ key }) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    }),
  };
  return binding;
}

const draftBody = JSON.stringify({ kind: "email", input: "x" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AI rate limit", () => {
  it("allows requests below and at the limit, then returns a standard 429 error", async () => {
    const limiter = makeLimiter(2);
    const app = createTestApp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "DRAFT" } }] }),
      { status: 200 },
    )));
    const request = () => app.request("/api/ai/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: draftBody,
    }, env(limiter));

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    const blocked = await request();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({
      error: { code: "RATE_LIMITED", message: expect.any(String) },
      meta: { requestId: "request-test" },
    });
    expect(limiter.limit).toHaveBeenCalledWith({
      key: JSON.stringify(["test-actor", "/api/ai/draft"]),
    });
  });

  it("keeps actor and route buckets independent", async () => {
    const limiter = makeLimiter(1);
    const app = createTestApp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "DRAFT" } }] }),
      { status: 200 },
    )));
    const request = (path: string, actor: string) => app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Actor": actor },
      body: draftBody,
    }, env(limiter));

    expect((await request("/api/ai/draft", "actor-a")).status).toBe(200);
    expect((await request("/api/ai/draft", "actor-b")).status).toBe(200);
    expect((await request("/api/ai/other", "actor-a")).status).toBe(404);
    expect((await request("/api/ai/draft", "actor-a")).status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({
      key: JSON.stringify(["actor-a", "/api/ai/draft"]),
    });
    expect(limiter.limit).toHaveBeenCalledWith({
      key: JSON.stringify(["actor-b", "/api/ai/draft"]),
    });
    expect(limiter.limit).toHaveBeenCalledWith({
      key: JSON.stringify(["actor-a", "/api/ai/other"]),
    });
  });
});
