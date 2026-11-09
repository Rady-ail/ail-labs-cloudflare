import {
  describe,
  test,
  expect,
  vi,
  beforeEach,
} from "vitest";

vi.mock("../src/lib/db", async () => {
  const { makeNeon } = await import("./pgmock");

  const sql = makeNeon();

  return {
    getSql: () => sql,
  };
});

import { app } from "../src/index";
import { getDb } from "./pgmock";

const UUID = "11111111-1111-4111-8111-111111111111";

const MISSING_UUID =
  "22222222-2222-4222-8222-222222222222";

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

function validBody() {
  return {
    subject_type: "supplier",
    subject_ref: "Example Medical Manufacturer",
    doc_type: "coa_same_batch",
    status: "belum",
    due_on: "2026-12-01",
    received_on: null,
    expires_on: null,
    file_url: null,
    note: "Awaiting same-batch certificate",
  };
}

async function resetDatabase() {
  const db = await getDb();

  await db.exec(`
    TRUNCATE TABLE
      compliance_items,
      audit_log
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await resetDatabase();
});

// ============================================================
// 1. LIST
// ============================================================

describe("Kepatuhan list", () => {
  test("GET /items returns empty list", async () => {
    const response = await request(
      "/api/kepatuhan/items",
      { headers },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as any;

    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
    expect(body.meta.page).toBe(1);
  });

  test("GET /items returns created documents", async () => {
    await request(
      "/api/kepatuhan/items",
      {
        method: "POST",
        headers,
        body: JSON.stringify(validBody()),
      },
    );

    const response = await request(
      "/api/kepatuhan/items?subject_type=supplier",
      { headers },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as any;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].doc_type).toBe("coa_same_batch");
  });

  test("unknown query parameter rejected", async () => {
    const response = await request(
      "/api/kepatuhan/items?unknown=value",
      { headers },
    );

    expect(response.status).toBe(400);

    const body = await response.json() as any;

    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.request_id).toBeTruthy();
  });
});

// ============================================================
// 2. CREATE
// ============================================================

describe("Kepatuhan create", () => {
  test("POST /items creates a document", async () => {
    const response = await request(
      "/api/kepatuhan/items",
      {
        method: "POST",
        headers,
        body: JSON.stringify(validBody()),
      },
    );

    expect(response.status).toBe(201);

    const body = await response.json() as any;

    expect(body.data.id).toBeTruthy();
    expect(body.data.subject_type).toBe("supplier");
    expect(body.data.status).toBe("belum");
  });

  test("POST /items rejects HTTP file URL", async () => {
    const response = await request(
      "/api/kepatuhan/items",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...validBody(),
          file_url: "http://example.com/document.pdf",
        }),
      },
    );

    expect(response.status).toBe(422);

    const body = await response.json() as any;

    expect(body.error.fields.file_url).toBeTruthy();
  });

  test("POST /items rejects verified status without received_on", async () => {
    const response = await request(
      "/api/kepatuhan/items",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...validBody(),
          status: "diverifikasi",
          received_on: null,
        }),
      },
    );

    expect(response.status).toBe(422);

    const body = await response.json() as any;

    expect(body.error.fields.received_on).toBeTruthy();
  });

  test("POST /items rejects expiry before received date", async () => {
    const response = await request(
      "/api/kepatuhan/items",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...validBody(),
          received_on: "2026-12-10",
          expires_on: "2026-12-01",
        }),
      },
    );

    expect(response.status).toBe(422);
  });
});

// ============================================================
// 3. UPDATE
// ============================================================

describe("Kepatuhan update", () => {
  test("PATCH /items/:id updates document", async () => {
    const created = await request(
      "/api/kepatuhan/items",
      {
        method: "POST",
        headers,
        body: JSON.stringify(validBody()),
      },
    );

    const createdBody = await created.json() as any;

    const id = createdBody.data.id;

    const response = await request(
      `/api/kepatuhan/items/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "diterima",
          received_on: "2026-11-10",
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as any;

    expect(body.data.status).toBe("diterima");
    expect(body.data.received_on).toBeTruthy();
  });

  test("PATCH rejects invalid UUID", async () => {
    const response = await request(
      "/api/kepatuhan/items/not-a-uuid",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          note: "Update",
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  test("PATCH rejects empty body", async () => {
    const response = await request(
      `/api/kepatuhan/items/${UUID}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(400);
  });

  test("PATCH rejects missing received_on when verifying", async () => {
    const created = await request(
      "/api/kepatuhan/items",
      {
        method: "POST",
        headers,
        body: JSON.stringify(validBody()),
      },
    );

    const createdBody = await created.json() as any;

    const response = await request(
      `/api/kepatuhan/items/${createdBody.data.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "diverifikasi",
        }),
      },
    );

    expect(response.status).toBe(422);
  });

  test("PATCH missing document returns 404", async () => {
    const response = await request(
      `/api/kepatuhan/items/${MISSING_UUID}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          note: "Update",
        }),
      },
    );

    expect(response.status).toBe(404);
  });
});

// ============================================================
// 4. BULK TEMPLATE
// ============================================================

describe("Kepatuhan bulk template", () => {
  test("creates all standard document types", async () => {
    const response = await request(
      "/api/kepatuhan/items/bulk-template",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject_type: "supplier",
          subject_ref: "Example Supplier",
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as any;

    expect(body.data.created).toBe(9);
    expect(body.data.skipped).toBe(0);
  });

  test("second request skips existing documents", async () => {
    const payload = {
      subject_type: "produk",
      subject_ref: "Example Product",
    };

    await request(
      "/api/kepatuhan/items/bulk-template",
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
    );

    const response = await request(
      "/api/kepatuhan/items/bulk-template",
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
    );

    const body = await response.json() as any;

    expect(body.data.created).toBe(0);
    expect(body.data.skipped).toBe(9);
  });
});

// ============================================================
// 5. SUMMARY
// ============================================================

describe("Kepatuhan summary", () => {
  test("GET /summary returns status counters", async () => {
    const response = await request(
      "/api/kepatuhan/summary",
      { headers },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as any;

    expect(body.data.by_status.belum).toBe(0);
    expect(body.data.overdue).toBe(0);
    expect(body.data.expired).toBe(0);
    expect(body.data.expiring_30_days).toBe(0);
  });

  test("summary rejects unknown parameters", async () => {
    const response = await request(
      "/api/kepatuhan/summary?page=1",
      { headers },
    );

    expect(response.status).toBe(400);
  });
});

// ============================================================
// 6. 404
// ============================================================

describe("Kepatuhan not found", () => {
  test("unknown route returns CRM error envelope", async () => {
    const response = await request(
      "/api/kepatuhan/unknown",
      { headers },
    );

    expect(response.status).toBe(404);

    const body = await response.json() as any;

    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.request_id).toBeTruthy();
  });
});

// ============================================================
// 7. Tambahan Claude: format tanggal, duplikat, verifikasi via PATCH
// ============================================================

describe("Kepatuhan: tanggal dan duplikat", () => {
  test("tanggal keluar sebagai YYYY-MM-DD", async () => {
    const r = await request("/api/kepatuhan/items", { method: "POST", headers, body: JSON.stringify({ ...validBody(), received_on: "2026-11-01" }) });
    const b = await r.json() as any;
    expect(b.data.due_on).toBe("2026-12-01");
    expect(b.data.received_on).toBe("2026-11-01");
    const l = await (await request("/api/kepatuhan/items", { headers })).json() as any;
    expect(l.data[0].due_on).toBe("2026-12-01");
    expect(l.data[0].expires_on).toBeNull();
  });

  test("dokumen ganda ditolak 409 (buat dan ubah)", async () => {
    const mk = (doc: string) => request("/api/kepatuhan/items", { method: "POST", headers, body: JSON.stringify({ ...validBody(), doc_type: doc }) });
    expect((await mk("halal")).status).toBe(201);
    expect((await mk("halal")).status).toBe(409);
    const other = await (await mk("inci")).json() as any;
    const r = await request(`/api/kepatuhan/items/${other.data.id}`, { method: "PATCH", headers, body: JSON.stringify({ doc_type: "halal" }) });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).error.code).toBe("COMPLIANCE_DUPLICATE");
  });

  test("PATCH verifikasi dengan tanggal lengkap dan cek kedaluwarsa terhadap data lama", async () => {
    const c = await (await request("/api/kepatuhan/items", { method: "POST", headers, body: JSON.stringify({ ...validBody(), received_on: "2026-11-01" }) })).json() as any;
    let r = await request(`/api/kepatuhan/items/${c.data.id}`, { method: "PATCH", headers, body: JSON.stringify({ expires_on: "2026-10-01" }) });
    expect(r.status).toBe(422);
    r = await request(`/api/kepatuhan/items/${c.data.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "diverifikasi", expires_on: "2027-10-01" }) });
    expect(r.status).toBe(200);
    const b = await r.json() as any;
    expect(b.data.status).toBe("diverifikasi");
    expect(b.data.expires_on).toBe("2027-10-01");
  });

  test("overdue dan summary menghitung dengan benar", async () => {
    const mk = (doc: string, extra: any) => request("/api/kepatuhan/items", { method: "POST", headers, body: JSON.stringify({ ...validBody(), doc_type: doc, ...extra }) });
    await mk("halal", { due_on: "2020-01-01" });
    await mk("inci", { due_on: "2020-01-01", status: "diverifikasi", received_on: "2019-12-01" });
    await mk("cfs", { due_on: null, received_on: "2019-01-01", expires_on: "2020-06-01", status: "diterima" });
    const o = await (await request("/api/kepatuhan/items?overdue=true", { headers })).json() as any;
    expect(o.data.length).toBe(1);
    expect(o.data[0].doc_type).toBe("halal");
    const s = await (await request("/api/kepatuhan/summary", { headers })).json() as any;
    expect(s.data.overdue).toBe(1);
    expect(s.data.expired).toBe(1);
    expect(s.data.total).toBe(3);
  });
});
