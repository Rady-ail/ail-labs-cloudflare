import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { operationsRoutes } from "../src/routes/operations";
import type { AppEnv } from "../src/lib/http";
import type { Env } from "../src/env";

const { sql } = vi.hoisted(() => ({ sql: vi.fn(async (): Promise<Record<string, unknown>[]> => []) }));
vi.mock("../src/lib/db", () => ({ getSql: () => sql }));
vi.mock("../src/lib/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
const env: Env = {
  DATABASE_URL: "postgres://test", RESEND_API_KEY: "", RESEND_WEBHOOK_SECRET: "",
  API_TOKEN: "token", EMAIL_SEND_MODE: "dry-run",
  AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const ID = "00000000-0000-4000-8000-000000000000";
function app() {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => { c.set("actor", "owner"); c.set("requestId", "test"); await next(); });
  a.route("/api/ops", operationsRoutes);
  return a;
}
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
afterEach(() => { sql.mockReset(); sql.mockResolvedValue([]); });

describe("workspace follow-ups and activities", () => {
  it("creates an activity for an existing clinic", async () => {
    sql.mockResolvedValueOnce([{ id: "a1", title: "Hubungi via WA" }]);
    const r = await app().request("/api/ops/activities", json({ entity_type: "clinic", entity_id: ID, title: "Hubungi via WA", activity_type: "whatsapp", due_at: "2026-11-20T09:00:00+08:00" }), env);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ data: { title: "Hubungi via WA" } });
  });
  it("returns 404 when the supplier or clinic does not exist", async () => {
    sql.mockResolvedValueOnce([]);
    const r = await app().request("/api/ops/activities", json({ entity_type: "supplier", entity_id: ID, title: "x" }), env);
    expect(r.status).toBe(404);
  });
  it("rejects bad type, bad id, unknown fields and bad dates without touching the database", async () => {
    for (const body of [
      { entity_type: "user", entity_id: ID, title: "x" },
      { entity_type: "clinic", entity_id: "nope", title: "x" },
      { entity_type: "clinic", entity_id: ID, title: "x", created_by: "hacker" },
      { entity_type: "clinic", entity_id: ID, title: "x", due_at: "besok" },
      { entity_type: "clinic", entity_id: ID, title: "  " },
    ]) {
      const r = await app().request("/api/ops/activities", json(body), env);
      expect(r.status).toBe(400);
    }
    expect(sql).not.toHaveBeenCalled();
  });
  it("lists activities for one entity and validates the query", async () => {
    sql.mockResolvedValueOnce([{ id: "a1" }]);
    const ok = await app().request(`/api/ops/activities?entity_type=clinic&entity_id=${ID}`, {}, env);
    expect(ok.status).toBe(200);
    const bad = await app().request("/api/ops/activities?entity_type=clinic", {}, env);
    expect(bad.status).toBe(400);
  });
  it("completes, reopens and deletes an activity", async () => {
    sql.mockResolvedValueOnce([{ id: ID, completed_at: "2026-11-15T00:00:00Z" }]);
    const done = await app().request(`/api/ops/activities/${ID}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }) }, env);
    expect(done.status).toBe(200);
    sql.mockResolvedValueOnce([]);
    const missing = await app().request(`/api/ops/activities/${ID}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: false }) }, env);
    expect(missing.status).toBe(404);
    sql.mockResolvedValueOnce([{ id: ID }]);
    const del = await app().request(`/api/ops/activities/${ID}`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    const badId = await app().request("/api/ops/activities/abc", { method: "DELETE" }, env);
    expect(badId.status).toBe(400);
  });
  it("summarises pipeline counts and due follow-ups", async () => {
    sql.mockResolvedValueOnce([{ status: "approved", n: 2 }]);
    sql.mockResolvedValueOnce([{ status: "lead", n: 5 }, { status: "customer", n: 1 }]);
    sql.mockResolvedValueOnce([{ overdue: 3, soon: 4 }]);
    const r = await app().request("/api/ops/summary", {}, env);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ suppliers: { approved: 2 }, clinics: { lead: 5, customer: 1 }, followups: { overdue: 3, soon: 4 } });
  });
  it("lists open follow-ups with entity names", async () => {
    sql.mockResolvedValueOnce([{ id: "a1", entity_name: "Klinik A" }]);
    const r = await app().request("/api/ops/followups", {}, env);
    expect(await r.json()).toMatchObject({ data: [{ entity_name: "Klinik A" }] });
  });
  it("reports 503 instead of leaking database errors", async () => {
    sql.mockRejectedValueOnce(new Error("relation does not exist"));
    const r = await app().request("/api/ops/followups", {}, env);
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("relation");
  });
});
