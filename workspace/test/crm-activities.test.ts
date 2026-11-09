import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/lib/http";
import { errorHandler } from "../src/lib/http";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/lib/db", () => ({
  getSql: () => (strings: TemplateStringsArray, ...values: unknown[]) =>
    mocks.query(strings.join("?"), values),
}));

import { crmRoutes } from "../src/routes/crm/clinics";

const clinicId = "8a2a9f24-0d12-4d8a-8a6b-7d3d5e2f9c11";

function send(body: unknown) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-test");
    c.set("actor", "test-actor");
    await next();
  });
  app.route("/api/crm", crmRoutes);
  app.onError(errorHandler);
  return app.request(`/api/crm/clinics/${clinicId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, {} as AppEnv["Bindings"]);
}

describe("POST /api/crm/clinics/:id/activities", () => {
  beforeEach(() => mocks.query.mockReset().mockResolvedValue([]));

  it("rejects unsupported activity types", async () => {
    const response = await send({ type: "sms", summary: "Follow up" });
    const body = await response.json() as any;

    expect(response.status).toBe(422);
    expect(body.error.fields.type).toBeDefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("recalculates interactions, orders and last contact in the insert statement", async () => {
    mocks.query.mockResolvedValueOnce([{
      id: "b3e1ac40-3f9b-4db6-a7b5-8b7f41c15b02",
      clinic_id: clinicId,
      type: "order",
      summary: "Trial order",
      occurred_at: "2026-11-09T12:00:00.000Z",
    }]);
    const response = await send({ type: "order", summary: "Trial order" });
    const body = await response.json() as any;

    expect(response.status).toBe(201);
    expect(body.data.type).toBe("order");
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain("count(*) FILTER");
    expect(sql).toContain("interactions_count");
    expect(sql).toContain("type IN ('call', 'whatsapp', 'email')");
    expect(sql).not.toContain("type IN ('call', 'whatsapp', 'email', 'visit')");

    expect(sql).toContain("orders_count");
    expect(sql).toContain("last_contact_at");
    expect(sql).toContain("max(occurred_at) FILTER (WHERE type IN ('call', 'whatsapp', 'email', 'visit'))");
    expect(sql).not.toContain("max(occurred_at) FILTER (WHERE type IN ('call', 'whatsapp', 'email', 'visit', 'order'))");

    expect(sql).toContain("INSERT INTO clinic_activities");
  });

  it("rejects unknown activity fields", async () => {
    const response = await send({ type: "note", summary: "Note", actor: "injected" });
    const body = await response.json() as any;

    expect(response.status).toBe(422);
    expect(body.error.fields.actor).toBeDefined();
  });
});
