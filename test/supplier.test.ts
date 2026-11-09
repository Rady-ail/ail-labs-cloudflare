import { describe, test, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  inserted: false,
  archive: false,
}));

vi.mock("../src/lib/db", () => ({
  getSql: () => async (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ) => {
    const query = strings.join(" ? ");

    state.calls.push(query);

    if (query.includes("ON CONFLICT (slug)")) {
      const inserted = !state.inserted;
      state.inserted = true;

      return [{
        id: "11111111-1111-4111-8111-111111111111",
        inserted,
      }];
    }

    if (query.includes("archived_at = COALESCE")) {
      if (state.archive) {
        return [];
      }

      state.archive = true;

      return [{
        id: "11111111-1111-4111-8111-111111111111",
        archived_at: new Date(),
      }];
    }

    if (query.includes("SELECT s.* FROM suppliers")) {
      return [];
    }

    return [];
  },
}));

import { app } from "../src/index";

import {
  supplierCreateSchema,
  supplierUpdateSchema,
  sampleCreateSchema,
  isSupplierSlugBlocked,
} from "../src/routes/supplier/supplierModel";

const UUID = "11111111-1111-4111-8111-111111111111";

const env: any = {
  API_TOKEN: "test-admin-token",
  DATABASE_URL: "postgres://test:test@localhost/test",
  EMAIL_SEND_MODE: "dry-run",
  DEV: "0",
};

const headers = {
  Authorization: "Bearer test-admin-token",
  "Content-Type": "application/json",
};

function request(
  path: string,
  init: RequestInit = {},
) {
  return app.request(path, init, env);
}

function supplierBody() {
  return {
    slug: "sample-supplier",
    name: "Example Medical Manufacturer",
    country: "South Korea",
    contact: "Sales Department",
    channel: "Business inquiry",
    category: "skincare_oem",
    status: "kandidat",
    terms: "Sample evaluation terms",
    note: "Pending technical documents",
  };
}

beforeEach(() => {
  state.calls.length = 0;
  state.inserted = false;
  state.archive = false;
});

// ---------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------

describe("Supplier validation", () => {
  test("supplier create valid", () => {
    expect(
      supplierCreateSchema.safeParse(supplierBody()).success,
    ).toBe(true);
  });

  test("supplier create rejects invalid category", () => {
    expect(
      supplierCreateSchema.safeParse({
        ...supplierBody(),
        category: "invalid",
      }).success,
    ).toBe(false);
  });

  test("supplier create rejects invalid status", () => {
    expect(
      supplierCreateSchema.safeParse({
        ...supplierBody(),
        status: "unknown",
      }).success,
    ).toBe(false);
  });

  test("supplier update rejects empty object", () => {
    expect(
      supplierUpdateSchema.safeParse({}).success,
    ).toBe(false);
  });

  test("sample create defaults state to diminta", () => {
    const result = sampleCreateSchema.safeParse({
      description: "Sample serum 30 ml",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.state).toBe("diminta");
    }
  });

  test("supplier blocked slug detection", () => {
    expect(isSupplierSlugBlocked("liyin-biotech")).toBe(true);
    expect(isSupplierSlugBlocked("LIYIN-TEST")).toBe(true);
    expect(isSupplierSlugBlocked("other-supplier")).toBe(false);
  });
});

// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------

describe("Supplier authentication", () => {
  test("401 without token", async () => {
    const response = await request("/api/supplier/suppliers");

    expect(response.status).toBe(401);

    const body = await response.json() as any;

    expect(body.error.request_id).toBeTruthy();
  });

  test("Access identity cannot import", async () => {
    const response = await request(
      "/api/supplier/import",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cf-Access-Jwt-Assertion": "invalid",
          Origin: "https://app.ail-aesthetic-labs.my.id",
        },
        body: JSON.stringify({
          items: [supplierBody()],
        }),
      },
    );

    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------
// BODY LIMIT
// ---------------------------------------------------------

describe("Supplier body limit", () => {
  test("413 payload above 262144 bytes", async () => {
    const response = await request(
      "/api/supplier/suppliers",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...supplierBody(),
          note: "x".repeat(270000),
        }),
      },
    );

    expect(response.status).toBe(413);

    const body = await response.json() as any;

    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.request_id).toBeTruthy();
  });
});

// ---------------------------------------------------------
// FILTER
// ---------------------------------------------------------

describe("Supplier filtering", () => {
  test("status category and q filters are accepted", async () => {
    const response = await request(
      "/api/supplier/suppliers?status=hold&category=filler&q=example",
      {
        headers,
      },
    );

    expect(response.status).toBe(200);

    expect(
      state.calls.some((query) =>
        query.includes("FROM suppliers s"),
      ),
    ).toBe(true);
  });

  test("invalid status is rejected", async () => {
    const response = await request(
      "/api/supplier/suppliers?status=unknown",
      {
        headers,
      },
    );

    expect(response.status).toBe(400);
  });

  test("unknown query parameter is rejected", async () => {
    const response = await request(
      "/api/supplier/suppliers?secret=value",
      {
        headers,
      },
    );

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------
// SOFT DELETE
// ---------------------------------------------------------

describe("Supplier archive", () => {
  test("archive uses archived_at rather than DELETE", async () => {
    const response = await request(
      `/api/supplier/suppliers/${UUID}/archive`,
      {
        method: "POST",
        headers,
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as any;

    expect(body.data.archived).toBe(true);

    expect(
      state.calls.some((query) =>
        query.includes("archived_at = COALESCE"),
      ),
    ).toBe(true);
  });

  test("invalid UUID is rejected", async () => {
    const response = await request(
      "/api/supplier/suppliers/not-a-uuid/archive",
      {
        method: "POST",
        headers,
      },
    );

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------
// IMPORT
// ---------------------------------------------------------

describe("Supplier import", () => {
  test("Liyin slug is rejected before database access", async () => {
    const response = await request(
      "/api/supplier/import",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [{
            ...supplierBody(),
            slug: "liyin-biotech",
          }],
        }),
      },
    );

    expect(response.status).toBe(422);

    expect(state.calls.length).toBe(0);
  });

  test("upsert is idempotent for repeated slug", async () => {
    const payload = {
      items: [supplierBody()],
    };

    const first = await request(
      "/api/supplier/import",
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
    );

    expect(first.status).toBe(200);

    const firstBody = await first.json() as any;

    expect(firstBody.data).toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
    });

    const second = await request(
      "/api/supplier/import",
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
    );

    expect(second.status).toBe(200);

    const secondBody = await second.json() as any;

    expect(secondBody.data).toEqual({
      created: 0,
      updated: 1,
      skipped: 0,
    });

    expect(
      state.calls.filter((query) =>
        query.includes("ON CONFLICT (slug)"),
      ).length,
    ).toBe(2);
  });

  test("invalid items are counted as skipped", async () => {
    const response = await request(
      "/api/supplier/import",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [
            supplierBody(),
            {
              slug: "invalid item",
              name: "",
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as any;

    expect(body.data.skipped).toBe(1);
    expect(body.data.created).toBe(1);
  });
});
