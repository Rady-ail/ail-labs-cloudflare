import { describe, expect, it, vi } from "vitest";
import { app } from "../src/index";

vi.mock("../src/lib/db", () => ({
  getSql: () => Object.assign(
    async () => [{ ok: 1 }],
    { query: vi.fn() },
  ),
}));

describe("GET /api/health", () => {
  it("returns db health without authentication", async () => {
    const response = await app.request("/api/health", {}, {
      DATABASE_URL: "postgres://test",
      RESEND_API_KEY: "",
      RESEND_WEBHOOK_SECRET: "",
      API_TOKEN: "",
      EMAIL_SEND_MODE: "dry-run",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, db: true });
  });

  it("rejects an unexpected Origin", async () => {
    const response = await app.request("/api/health", {
      headers: { Origin: "https://evil.example" },
    }, {
      DATABASE_URL: "postgres://test",
      RESEND_API_KEY: "",
      RESEND_WEBHOOK_SECRET: "",
      API_TOKEN: "",
      EMAIL_SEND_MODE: "dry-run",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    expect(response.status).toBe(403);
  });
});
