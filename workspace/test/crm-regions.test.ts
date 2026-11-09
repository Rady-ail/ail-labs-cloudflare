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

describe("GET /api/crm/regions/summary", () => {
  beforeEach(() => mocks.query.mockReset().mockResolvedValue([]));

  it("returns province aggregates from active clinics", async () => {
    mocks.query.mockResolvedValueOnce([{
      province: "Kalimantan Selatan",
      clinics_count: 12,
      lead_count: 4,
      interactions_count: 28,
      orders_count: 3,
    }]);
    const response = await api().request("/api/crm/regions/summary", {}, {} as AppEnv["Bindings"]);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.data[0].province).toBe("Kalimantan Selatan");
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain("WHERE archived = false");
    expect(sql).toContain("GROUP BY province");
    expect(sql).toContain("sum(interactions_count)");
    expect(sql).toContain("sum(orders_count)");
  });

  it("rejects unsupported query parameters", async () => {
    const response = await api().request("/api/crm/regions/summary?province=unknown", {}, {} as AppEnv["Bindings"]);
    const body = await response.json() as any;

    expect(response.status).toBe(400);
    expect(body.error.fields.province).toBeDefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
