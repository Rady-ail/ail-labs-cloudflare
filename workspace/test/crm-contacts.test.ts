import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/lib/http";
import { errorHandler } from "../src/lib/http";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getSql: () => Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => mocks.query(strings.join("?"), values),
    { transaction: mocks.transaction },
  ),
}));

import { crmRoutes } from "../src/routes/crm/clinics";

const clinicId = "8a2a9f24-0d12-4d8a-8a6b-7d3d5e2f9c11";
const contactId = "b3e1ac40-3f9b-4db6-a7b5-8b7f41c15b02";

function app() {
  const instance = new Hono<AppEnv>();
  instance.use("*", async (c, next) => {
    c.set("requestId", "request-test");
    c.set("actor", "test-actor");
    await next();
  });
  instance.route("/api/crm", crmRoutes);
  instance.onError(errorHandler);
  return instance;
}

function post(body: unknown) {
  return app().request(`/api/crm/clinics/${clinicId}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, {} as AppEnv["Bindings"]);
}

describe("clinic contacts", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([]);
    mocks.transaction.mockReset().mockResolvedValue([]);
  });

  it("rejects unknown fields with a CRM validation envelope", async () => {
    const response = await post({ name: "Dr A", is_admin: true });
    const body = await response.json() as any;

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.is_admin).toBeDefined();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates a primary contact in one transaction and clears previous primary", async () => {
    mocks.transaction.mockResolvedValueOnce([
      [{ id: clinicId }],
      [],
      [{ id: contactId, clinic_id: clinicId, name: "Dr A", is_primary: true }],
    ]);
    const response = await post({ name: "Dr A", is_primary: true });
    const body = await response.json() as any;

    expect(response.status).toBe(201);
    expect(body.data.is_primary).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(3);
    expect(mocks.query.mock.calls.some((call) => String(call[0]).includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("requires a name when creating a contact", async () => {
    const response = await post({ phone: "081234567890" });
    const body = await response.json() as any;

    expect(response.status).toBe(422);
    expect(body.error.fields.name).toBeDefined();
  });

  it("lists contacts for an active clinic", async () => {
    mocks.query
      .mockResolvedValueOnce([{ archived: false }])
      .mockResolvedValueOnce([{ id: contactId, clinic_id: clinicId, name: "Dr A", is_primary: true }]);
    const response = await app().request(\`/api/crm/clinics/\${clinicId}/contacts\`, {}, {} as AppEnv["Bindings"]);

    expect(response.status).toBe(200);
    expect((await response.json() as any).data).toHaveLength(1);
    expect(String(mocks.query.mock.calls[1][0])).toContain("FROM clinic_contacts");
  });

  it("promotes a contact to primary inside a transaction", async () => {
    mocks.transaction.mockResolvedValueOnce([
      [{ id: clinicId }],
      [],
      [{ id: contactId, clinic_id: clinicId, name: "Dr A", is_primary: true }],
    ]);
    const response = await app().request(\`/api/crm/clinics/\${clinicId}/contacts/\${contactId}\`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_primary: true }),
    }, {} as AppEnv["Bindings"]);

    expect(response.status).toBe(200);
    expect((await response.json() as any).data.is_primary).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const statements = mocks.transaction.mock.calls[0][0] as unknown[];
    expect(statements).toHaveLength(3);
  });

  it("deletes a contact belonging to the clinic", async () => {
    mocks.query
      .mockResolvedValueOnce([{ archived: false }])
      .mockResolvedValueOnce([{ id: contactId }])
      .mockResolvedValueOnce([]);
    const response = await app().request(\`/api/crm/clinics/\${clinicId}/contacts/\${contactId}\`, {
      method: "DELETE",
    }, {} as AppEnv["Bindings"]);

    expect(response.status).toBe(200);
    expect((await response.json() as any).data).toEqual({ id: contactId, deleted: true });
    expect(String(mocks.query.mock.calls[1][0])).toContain("DELETE FROM clinic_contacts");
  });

});
