import { describe, expect, it } from "vitest";
import { app } from "../src/index";

const env = {
  DATABASE_URL: "postgres://test",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
  API_TOKEN: "test-api-token",
  EMAIL_SEND_MODE: "dry-run" as const,
  AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

describe("API authentication boundary", () => {
  it("rejects protected routes without credentials", async () => {
    const response = await app.request("/api/private", {}, env);
    expect(response.status).toBe(401);
  });

  it("accepts a valid Bearer token and reaches route resolution", async () => {
    const response = await app.request("/api/private", {
      headers: { Authorization: "Bearer test-api-token" },
    }, env);
    expect(response.status).toBe(404);
  });

  it("rejects an invalid Bearer token", async () => {
    const response = await app.request("/api/private", {
      headers: { Authorization: "Bearer wrong" },
    }, env);
    expect(response.status).toBe(401);
  });
});
