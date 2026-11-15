import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { procurementRoutes } from "../src/routes/procurement";
import { computeLanded } from "../src/lib/landed";
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
  a.route("/api/proc", procurementRoutes);
  return a;
}
const send = (method: string, body?: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
afterEach(() => { sql.mockReset(); sql.mockResolvedValue([]); });

const inputs = { fob: 10, qty: 100, kurs: 16000, freight: 200, insPct: 0.5, dutyPct: 5, ppnPct: 11, pphPct: 2.5, other: 500000, margin: 30, taxCost: true };

describe("computeLanded", () => {
  it("matches a hand-computed example", () => {
    const r = computeLanded({ fob: 10, qty: 100, kurs: 16000, freight: 0, insPct: 0, dutyPct: 0, ppnPct: 0, pphPct: 0, other: 0, margin: 0, taxCost: true });
    expect(r.total).toBe(16_000_000);
    expect(r.unit).toBe(160_000);
    expect(r.price).toBe(160_000);
  });
  it("applies insurance, duty, PPN and PPh in order and divides by (1 - margin)", () => {
    const r = computeLanded(inputs);
    const goods = 10 * 100 * 16000, freight = 200 * 16000, ins = (goods + freight) * 0.005, cif = goods + freight + ins;
    const duty = cif * 0.05, base = cif + duty;
    const total = cif + duty + base * 0.11 + base * 0.025 + 500000;
    expect(r.total).toBeCloseTo(total, 4);
    expect(r.unit).toBeCloseTo(total / 100, 6);
    expect(r.price).toBeCloseTo(total / 100 / 0.7, 6);
  });
  it("leaves PPN and PPh out of cost when taxCost is false", () => {
    const withTax = computeLanded(inputs).total;
    const without = computeLanded({ ...inputs, taxCost: false }).total;
    expect(without).toBeLessThan(withTax);
  });
  it("returns NaN rather than a wrong number for qty 0 or margin 100", () => {
    expect(Number.isNaN(computeLanded({ ...inputs, qty: 0 }).unit)).toBe(true);
    expect(Number.isNaN(computeLanded({ ...inputs, margin: 100 }).price)).toBe(true);
  });
});

describe("supplier SOP stage and gates", () => {
  it("lists suppliers with stage and gates", async () => {
    sql.mockResolvedValueOnce([{ id: ID, name: "X", sop_stage: "aktif", gates: [] }]);
    const r = await app().request("/api/proc/sop", {}, env);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ data: [{ sop_stage: "aktif" }] });
  });
  it("returns a safe 503 without leaking database text when migration 006 is missing", async () => {
    sql.mockRejectedValueOnce(new Error('relation "workspace_supplier_gates" does not exist'));
    const r = await app().request("/api/proc/sop", {}, env);
    expect(r.status).toBe(503);
    const text = await r.text();
    expect(text).toContain("migrasi 006");
    expect(text).not.toContain("relation");
  });
  it("changes the stage, 404s on a missing supplier, rejects unknown stages", async () => {
    sql.mockResolvedValueOnce([{ id: ID, sop_stage: "tertahan" }]);
    expect((await app().request(`/api/proc/sop/${ID}`, send("PATCH", { sop_stage: "tertahan" }), env)).status).toBe(200);
    sql.mockResolvedValueOnce([]);
    expect((await app().request(`/api/proc/sop/${ID}`, send("PATCH", { sop_stage: "ditutup" }), env)).status).toBe(404);
    sql.mockClear();
    for (const body of [{ sop_stage: "selesai" }, {}, { sop_stage: "aktif", extra: 1 }]) {
      expect((await app().request(`/api/proc/sop/${ID}`, send("PATCH", body), env)).status).toBe(400);
    }
    expect((await app().request("/api/proc/sop/abc", send("PATCH", { sop_stage: "aktif" }), env)).status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });
  it("upserts a gate and validates gate name, state and unknown fields", async () => {
    sql.mockResolvedValueOnce([{ supplier_id: ID, gate: "halal", state: "diminta", note: "", updated_at: "2026-11-15T00:00:00Z" }]);
    expect((await app().request(`/api/proc/sop/${ID}/gates/halal`, send("PUT", { state: "diminta" }), env)).status).toBe(200);
    sql.mockResolvedValueOnce([]);
    expect((await app().request(`/api/proc/sop/${ID}/gates/cfs`, send("PUT", { state: "belum" }), env)).status).toBe(404);
    sql.mockClear();
    expect((await app().request(`/api/proc/sop/${ID}/gates/pajak`, send("PUT", { state: "belum" }), env)).status).toBe(400);
    expect((await app().request(`/api/proc/sop/${ID}/gates/halal`, send("PUT", { state: "lulus" }), env)).status).toBe(400);
    expect((await app().request(`/api/proc/sop/${ID}/gates/halal`, send("PUT", { state: "belum", supplier_id: ID }), env)).status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("saved landed cost quotes", () => {
  it("stores a quote with server-computed numbers, ignoring any client totals", async () => {
    sql.mockResolvedValueOnce([{ id: "q1", product: "Serum A" }]);
    const r = await app().request("/api/proc/quotes", send("POST", { supplier_id: ID, product: " Serum A ", inputs }), env);
    expect(r.status).toBe(201);
    const values = sql.mock.calls[0].slice(1) as unknown[];
    const expected = computeLanded(inputs);
    expect(values).toContain(expected.total);
    expect(values).toContain(expected.unit);
    expect(values).toContain("Serum A");
  });
  it("rejects client-supplied totals, absurd or non-finite inputs, and blank products without touching the database", async () => {
    for (const body of [
      { product: "A", inputs: { ...inputs, total: 1 } },
      { product: "A", inputs: { ...inputs, qty: 0 } },
      { product: "A", inputs: { ...inputs, margin: 100 } },
      { product: "A", inputs: { ...inputs, kurs: -1 } },
      { product: "A", inputs: { ...inputs, fob: "10" } },
      { product: "  ", inputs },
      { product: "A", inputs, unit_idr: 1 },
      { product: "A", supplier_id: "nope", inputs },
    ]) {
      expect((await app().request("/api/proc/quotes", send("POST", body), env)).status).toBe(400);
    }
    expect(sql).not.toHaveBeenCalled();
  });
  it("404s for an unknown supplier, lists and deletes quotes", async () => {
    sql.mockResolvedValueOnce([]);
    expect((await app().request("/api/proc/quotes", send("POST", { supplier_id: ID, product: "A", inputs }), env)).status).toBe(404);
    sql.mockResolvedValueOnce([{ id: "q1" }]);
    expect((await app().request("/api/proc/quotes", {}, env)).status).toBe(200);
    sql.mockResolvedValueOnce([{ id: ID }]);
    expect((await app().request(`/api/proc/quotes/${ID}`, { method: "DELETE" }, env)).status).toBe(200);
    sql.mockResolvedValueOnce([]);
    expect((await app().request(`/api/proc/quotes/${ID}`, { method: "DELETE" }, env)).status).toBe(404);
    expect((await app().request("/api/proc/quotes/abc", { method: "DELETE" }, env)).status).toBe(400);
  });
});

describe("Hari ini", () => {
  it("combines the four sections", async () => {
    sql.mockResolvedValueOnce([{ id: "a1", title: "WA klinik", overdue: true }])
      .mockResolvedValueOnce([{ id: "p1", action_type: "supplier_reply" }])
      .mockResolvedValueOnce([{ supplier_id: ID, name: "S", gate: "halal" }])
      .mockResolvedValueOnce([{ n: 3 }]);
    const r = await app().request("/api/proc/today", {}, env);
    const body = await r.json() as Record<string, unknown>;
    expect(r.status).toBe(200);
    expect(body).toMatchObject({ held: 3, unavailable: [] });
    expect((body.followups as unknown[]).length).toBe(1);
    expect((body.approvals as unknown[]).length).toBe(1);
    expect((body.waiting_docs as unknown[]).length).toBe(1);
  });
  it("still returns follow-ups when the 006 tables are missing and names what failed", async () => {
    sql.mockResolvedValueOnce([{ id: "a1", title: "WA klinik", overdue: false }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('relation "workspace_supplier_gates" does not exist'))
      .mockRejectedValueOnce(new Error("no column sop_stage"));
    const r = await app().request("/api/proc/today", {}, env);
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ unavailable: ["waiting_docs", "held"], held: 0 });
    expect((JSON.parse(text).followups as unknown[]).length).toBe(1);
    expect(text).not.toContain("relation");
  });
  it("scopes approvals to the calling actor", async () => {
    await app().request("/api/proc/today", {}, env);
    const approvalsCall = sql.mock.calls[1] as unknown[];
    expect(approvalsCall.slice(1)).toContain("owner");
  });
});

describe("POST /api/proc/check", () => {
  it("mengembalikan hasil pemeriksaan tanpa menyentuh database", async () => {
    const r = await app().request("/api/proc/check", send("POST", { text: "We will pay a 30% deposit.", direction: "draft" }));
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.data.ok).toBe(false);
    expect(j.data.findings[0].id).toBe("pembayaran_di_muka");
    expect(sql).not.toHaveBeenCalled();
  });
  it("menolak input tidak valid", async () => {
    for (const body of [{ text: "", direction: "draft" }, { text: "x", direction: "other" }, { text: "x".repeat(20001), direction: "draft" }, { text: "x", direction: "draft", extra: 1 }]) {
      expect((await app().request("/api/proc/check", send("POST", body))).status).toBe(400);
    }
  });
});
