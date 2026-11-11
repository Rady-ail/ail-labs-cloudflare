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
function app() {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => { c.set("actor", "owner"); c.set("requestId", "test"); await next(); });
  a.route("/api/ops", operationsRoutes);
  return a;
}
afterEach(() => { sql.mockReset(); sql.mockResolvedValue([]); });

describe("workspace operations API", () => {
  it("validates and creates a supplier with parameterized SQL", async () => {
    sql.mockResolvedValueOnce([{ id: "id-1", name: "Supplier A", status: "prospect" }]);
    const response = await app().request("/api/ops/suppliers", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:"Supplier A",country:"Japan"}) }, env);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({data:{name:"Supplier A"}});
    expect(sql).toHaveBeenCalledOnce();
  });
  it("rejects invalid or unknown fields", async () => {
    const response = await app().request("/api/ops/clinics", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:"",isAdmin:true}) }, env);
    expect(response.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });
  it("returns 404 when updating a missing supplier", async () => {
    sql.mockResolvedValueOnce([]);
    const response = await app().request("/api/ops/suppliers/00000000-0000-4000-8000-000000000000", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({status:"approved"}) }, env);
    expect(response.status).toBe(404);
  });
  it("lists supplier records from the database", async () => {
    sql.mockResolvedValueOnce([{ id: "id-1", name: "Supplier A" }]);
    const response = await app().request("/api/ops/suppliers", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ name: "Supplier A" }] });
  });
  it("updates a clinic status", async () => {
    sql.mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-000000000000", name: "Clinic A", status: "customer" }]);
    const response = await app().request("/api/ops/clinics/00000000-0000-4000-8000-000000000000", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({status:"customer"}) }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({data:{status:"customer"}});
  });
  it("deletes a clinic record", async () => {
    sql.mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-000000000000" }]);
    const response = await app().request("/api/ops/clinics/00000000-0000-4000-8000-000000000000", { method:"DELETE" }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ok:true});
  });
  it("reports configured integration readiness", async () => {
    sql.mockResolvedValueOnce([{ ok: 1 }]);
    const response = await app().request("/api/ops/status", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({database:true,email:false,emailMode:"dry-run"});
  });
  it("rejects malformed IDs before database access", async () => {
    const response = await app().request("/api/ops/clinics/not-a-uuid", { method:"DELETE" }, env);
    expect(response.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });
});
