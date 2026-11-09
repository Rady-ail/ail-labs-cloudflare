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
const followupId = "b3e1ac40-3f9b-4db6-a7b5-8b7f41c15b02";

function api() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-test");
    c.set("actor", "test-actor");
    await next();
  });
  app.route("/api/crm", crmRoutes);
  app.onError(errorHandler);
  return app;
}

function postFollowup(body: unknown) {
  return api().request(`/api/crm/clinics/${clinicId}/follow-ups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, {} as AppEnv["Bindings"]);
}

describe("CRM follow-ups", () => {
  beforeEach(() => mocks.query.mockReset().mockResolvedValue([]));

  it("validates required fields and rejects unknown keys", async () => {
    const response = await postFollowup({ scheduled_at: "2026-11-12T10:00:00Z", payload: "x" });
    const body = await response.json() as any;

    expect(response.status).toBe(422);
    expect(body.error.fields.reason).toBeDefined();
    expect(body.error.fields.payload).toBeDefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("updates the existing pending follow-up or inserts only when none exists", async () => {
    mocks.query.mockResolvedValueOnce([{
      id: followupId,
      clinic_id: clinicId,
      scheduled_at: "2026-11-12T10:00:00.000Z",
      reason: "Review sample",
      completed: false,
    }]);
    const response = await postFollowup({
      scheduled_at: "2026-11-12T10:00:00Z",
      reason: "Review sample",
    });
    const body = await response.json() as any;

    expect(response.status).toBe(201);
    expect(body.data.id).toBe(followupId);
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain("UPDATE clinic_followups");
    expect(sql).toContain("INSERT INTO clinic_followups");
    expect(sql).toContain("next_followup_at");
    expect(sql).toContain("next_followup_reason");
  });

  it("rejects unknown query parameters on the follow-up list", async () => {
    const response = await api().request("/api/crm/follow-ups?unexpected=1", {}, {} as AppEnv["Bindings"]);
    const body = await response.json() as any;

    expect(response.status).toBe(400);
    expect(body.error.fields.unexpected).toBeDefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("lists pending follow-ups", async () => {
    mocks.query.mockResolvedValueOnce([{ id: followupId, clinic_id: clinicId, completed: false }]);
    const response = await api().request("/api/crm/follow-ups?status=pending", {}, {} as AppEnv["Bindings"]);

    expect(response.status).toBe(200);
    expect((await response.json() as any).data).toHaveLength(1);
    expect(String(mocks.query.mock.calls[0][0])).toContain("f.completed = false");
  });
});
