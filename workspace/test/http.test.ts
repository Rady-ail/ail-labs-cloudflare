import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { errorHandler, type AppEnv } from "../src/lib/http";

const env: Env = {
  DATABASE_URL: "",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
  API_TOKEN: "",
  EMAIL_SEND_MODE: "dry-run",
  AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function testApp(handler: () => Response | Promise<Response> | never) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-test");
    await next();
  });
  app.onError(errorHandler);
  app.get("/", handler);
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe("HTTP error handling", () => {
  it("keeps client HTTPException status and returns a generic JSON error", async () => {
    const app = testApp(() => {
      throw new HTTPException(422, { message: "private detail" });
    });

    const response = await app.request("/", {}, env);
    expect(response.status).toBe(422);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      error: { code: "HTTP_ERROR", message: "Permintaan tidak dapat diproses" },
      meta: { requestId: "request-test" },
    });
  });

  it("logs only a request ID and error class for internal failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = testApp(() => {
      throw new Error("private provider detail");
    });

    const response = await app.request("/", {}, env);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan internal" },
      meta: { requestId: "request-test" },
    });
    expect(log).toHaveBeenCalledWith("Unhandled request error", {
      requestId: "request-test",
      name: "Error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private provider detail");
  });
});
