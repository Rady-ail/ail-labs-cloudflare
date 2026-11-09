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

function makeApp() {
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

function archive() {
  return makeApp().request(`/api/crm/clinics/${clinicId}/archive`, {
    method: "POST",
  }, {} as AppEnv["Bindings"]);
}

describe("POST /api/crm/clinics/:id/archive", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue([]);
  });

  it("soft archives an existing clinic", async () => {
    mocks.query.mockResolvedValueOnce([{ id: clinicId, archived: true }]);
    const response = await archive();
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ id: clinicId, archived: true });
    expect(mocks.query.mock.calls[0][0]).toContain("SET archived = true");
  });

  it("is idempotent for an already archived clinic", async () => {
    mocks.query.mockResolvedValueOnce([{ id: clinicId, archived: true }]);
    const first = await archive();
    mocks.query.mockResolvedValueOnce([{ id: clinicId, archived: true }]);
    const second = await archive();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json() as any).data.archived).toBe(true);
  });

  it("returns a CRM 404 envelope when the clinic is missing", async () => {
    const response = await archive();
    const body = await response.json() as any;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("CLINIC_NOT_FOUND");
    expect(body.error.request_id).toBe("request-test");
  });
});
