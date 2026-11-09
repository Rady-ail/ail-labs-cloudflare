import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { authMiddleware, constantTimeEqual } from "../src/lib/auth";
import { errorHandler, notFound, requestId, type AppEnv } from "../src/lib/http";
import { isUuid, normalizePhoneId, pickAllowed } from "../src/lib/validate";

const validPhone = "6281234567890";
const validUuid = "550e8400-e29b-41d4-a716-446655440000";

function authTestApp() {
  const testApp = new Hono<AppEnv>();
  testApp.use("*", requestId());
  testApp.get("/protected", c => c.json({ actor: c.get("actor") }));
  return testApp;
}

describe("phone normalization", () => {
  it.each(["081234567890", "81234567890", "+6281234567890", "6281234567890"])("normalizes %s", (value) => {
    expect(normalizePhoneId(value)).toBe(validPhone);
  });
  it.each(["0812", "628123", "12345678901234", ""])("rejects %s", (value) => {
    expect(normalizePhoneId(value)).toBeNull();
  });
  it("converts the 0062 prefix", () => {
    expect(normalizePhoneId("006281234567890")).toBe(validPhone);
  });
});

describe("validation helpers", () => {
  it("accepts and rejects UUID values", () => {
    expect(isUuid(validUuid)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
  it("rejects fields outside the allow-list", () => {
    expect(() => pickAllowed({ name: "Clinic", admin: true }, ["name"])).toThrow(/Unknown fields/);
  });
});

describe("authentication", () => {
  it("returns 401 without authorization", async () => {
    const response = await authTestApp().request("/protected", {}, { DATABASE_URL: "unused", API_TOKEN: "right-token", RESEND_API_KEY: "unused", RESEND_WEBHOOK_SECRET: "unused", EMAIL_SEND_MODE: "dry-run" });
    expect(response.status).toBe(401);
  });
  it("returns 401 for a wrong bearer token", async () => {
    const response = await authTestApp().request("/protected", { headers: { Authorization: "Bearer wrong-token" } }, { DATABASE_URL: "unused", API_TOKEN: "right-token", RESEND_API_KEY: "unused", RESEND_WEBHOOK_SECRET: "unused", EMAIL_SEND_MODE: "dry-run" });
    expect(response.status).toBe(401);
  });
  it("accepts the correct bearer token and sets owner actor", async () => {
    const response = await authTestApp().request("/protected", { headers: { Authorization: "Bearer right-token" } }, { DATABASE_URL: "unused", API_TOKEN: "right-token", RESEND_API_KEY: "unused", RESEND_WEBHOOK_SECRET: "unused", EMAIL_SEND_MODE: "dry-run" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actor: "owner" });
  });
  it("compares equal and unequal strings without timing assertions", () => {
    expect(constantTimeEqual("same-token", "same-token")).toBe(true);
    expect(constantTimeEqual("same-token", "other-token")).toBe(false);
  });
});

describe("HTTP errors", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const testApp = new Hono<AppEnv>();
    testApp.use("*", requestId());
    testApp.notFound(notFound);
    const response = await testApp.request("/missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
  it("returns a generic 500 without leaking stack or SQL", async () => {
    const testApp = new Hono<AppEnv>();
    testApp.use("*", requestId());
    testApp.get("/explode", () => { throw new Error("secret SQL select * from private_table"); });
    testApp.onError(errorHandler);
    const response = await testApp.request("/explode");
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).toContain("INTERNAL_ERROR");
    expect(body).not.toContain("secret SQL");
    expect(body).not.toContain("at ");
  });
});

vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: vi.fn().mockResolvedValue([{ ok: 1 }]) }),
}));

describe("health route", () => {
  it("responds 200 without auth when SELECT 1 succeeds", async () => {
    const { app } = await import("../src/index");
    const response = await app.request("/api/health", {}, {
      DATABASE_URL: "test-database-url",
      API_TOKEN: "unused",
      RESEND_API_KEY: "unused",
      RESEND_WEBHOOK_SECRET: "unused",
      EMAIL_SEND_MODE: "dry-run",
      ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, db: true });
  });
});