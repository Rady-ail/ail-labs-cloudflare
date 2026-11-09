import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/lib/http";
import { errorHandler } from "../src/lib/http";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getSql: () => Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      mocks.query(strings.join("?"), values),
  ),
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

function request(body: unknown, id = clinicId) {
  return makeApp().request(`/api/crm/clinics/${id}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, {} as AppEnv["Bindings"]);
}

describe("POST /api/crm/clinics/:id/stage", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue([]);
  });

  it("returns 422 INVALID_STAGE for an unsupported stage", async () => {
    const response = await request({ stage: "won" });
    const body = await response.json() as any;

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("INVALID_STAGE");
    expect(body.error.request_id).toBe("request-test");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects fields outside the stage allowlist", async () => {
    const response = await request({ stage: "contacted", archived: true });
    const body = await response.json() as any;

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.archived).toBeDefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns 404 when the clinic does not exist", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const response = await request({ stage: "contacted" });
    const body = await response.json() as any;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("CLINIC_NOT_FOUND");
  });

  it("returns 409 when the clinic is archived", async () => {
    mocks.query.mockResolvedValueOnce([{ archived: true }]);
    const response = await request({ stage: "contacted" });
    const body = await response.json() as any;

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("ARCHIVED_CLINIC");
  });

  it("updates the stage and writes stage_change activity atomically", async () => {
    mocks.query
      .mockResolvedValueOnce([{ archived: false }])
      .mockResolvedValueOnce([{
        id: clinicId,
        previous_stage: "lead",
        stage: "contacted",
      }]);
    const response = await request({ stage: "contacted" });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: clinicId,
      previous_stage: "lead",
      stage: "contacted",
    });
    const statement = mocks.query.mock.calls[1][0] as string;
    expect(statement).toContain("UPDATE clinics");
    expect(statement).toContain("INSERT INTO clinic_activities");
    expect(statement).toContain("'stage_change'");
    expect(mocks.query).toHaveBeenCalledTimes(3); // active-clinic guard + atomic mutation + audit record
  });
});
