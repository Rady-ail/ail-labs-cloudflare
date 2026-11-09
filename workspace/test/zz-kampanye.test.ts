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

const call = (
  path: string,
  init: RequestInit = {},
) =>
  app.request(
    path,
    {
      ...init,
      headers: {
        ...headers,
        ...(init.headers ?? {}),
      },
    },
    env,
  );

function payload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Kampanye Uji",
    channel: "email",
    status: "draft",
    subject: "Informasi Produk AIL LABS",
    body: "Halo, kami memperkenalkan katalog produk terbaru AIL LABS.",
    product_ids: [],
    audience_filter: {},
    scheduled_at: null,
    daily_limit: 150,
    ...overrides,
  };
}

async function createCampaign(
  overrides: Record<string, unknown> = {},
) {
  const response = await call(
    "/api/kampanye/campaigns",
    {
      method: "POST",
      body: JSON.stringify(payload(overrides)),
    },
  );

  return {
    response,
    body: await response.json() as any,
  };
}

async function reset() {
  const db = await getDb();

  await db.exec(`
    TRUNCATE TABLE
      campaign_recipients,
      campaigns,
      clinics,
      audit_log
    RESTART IDENTITY CASCADE
  `);

  await db.exec(`
    DELETE FROM email_suppressions
  `);
}

async function seedClinic(input: {
  name: string;
  email?: string | null;
  phone?: string | null;
  province?: string;
  stage?: string;
  archived?: boolean;
}) {
  const db = await getDb();

  const rows = await db.query(
    `
      INSERT INTO clinics (
        name,
        city,
        province,
        email,
        phone,
        stage,
        archived
      )
      VALUES ($1, 'Jakarta', $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      input.name,
      input.province ?? "DKI Jakarta",
      input.email ?? null,
      input.phone ?? null,
      input.stage ?? "lead",
      input.archived ?? false,
    ],
  );

  return String((rows.rows[0] as any).id);
}

beforeEach(async () => {
  await reset();
});

// ============================================================
// 1. CREATE + LIST
// ============================================================

describe("Kampanye create dan list", () => {
  test("POST creates campaign", async () => {
    const { response, body } = await createCampaign();

    expect(response.status).toBe(201);

    expect(body.data.id).toBeTruthy();
    expect(body.data.name).toBe("Kampanye Uji");
    expect(body.data.channel).toBe("email");
    expect(body.data.status).toBe("draft");
  });

  test("GET lists campaigns and pagination", async () => {
    await createCampaign();

    const response = await call(
      "/api/kampanye/campaigns?page=1&limit=10",
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;

    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
    expect(body.meta.page).toBe(1);
  });
});

// ============================================================
// 2. DUPLICATE 23505 -> 409
// ============================================================

describe("Kampanye duplicate handling", () => {
  test("duplicate campaign name returns HTTP 409", async () => {
    const first = await createCampaign({
      name: "Promo Klinik",
    });

    expect(first.response.status).toBe(201);

    const second = await createCampaign({
      name: "promo klinik",
    });

    expect(second.response.status).toBe(409);

    expect(second.body.error.code).toBe(
      "CAMPAIGN_DUPLICATE",
    );

    expect(second.body.error.request_id).toBeTruthy();
  });

  test("unique violation is really PostgreSQL 23505", async () => {
    const db = await getDb();

    await db.exec(`
      INSERT INTO campaigns (
        name,
        channel,
        body
      )
      VALUES (
        'Duplicate Test',
        'email',
        'Test'
      )
    `);

    let error: any;

    try {
      await db.exec(`
        INSERT INTO campaigns (
          name,
          channel,
          body
        )
        VALUES (
          'duplicate test',
          'email',
          'Test'
        )
      `);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeTruthy();
    expect(error.code).toBe("23505");
  });
});

// ============================================================
// 3. UPDATE
// ============================================================

describe("Kampanye update", () => {
  test("PATCH updates campaign", async () => {
    const created = await createCampaign();

    const id = created.body.data.id;

    const response = await call(
      `/api/kampanye/campaigns/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "siap",
          daily_limit: 50,
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;

    expect(body.data.status).toBe("siap");
    expect(body.data.daily_limit).toBe(50);
  });

  test("PATCH duplicate name returns 409", async () => {
    await createCampaign({
      name: "Kampanye A",
    });

    const second = await createCampaign({
      name: "Kampanye B",
    });

    const response = await call(
      `/api/kampanye/campaigns/${second.body.data.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Kampanye A",
        }),
      },
    );

    expect(response.status).toBe(409);
  });

  test("PATCH unknown field rejected", async () => {
    const created = await createCampaign();

    const response = await call(
      `/api/kampanye/campaigns/${created.body.data.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          unknown: true,
        }),
      },
    );

    expect(response.status).toBe(400);
  });
});

// ============================================================
// 4. VALIDATION
// ============================================================

describe("Kampanye validation", () => {
  test("invalid audience stage rejected", async () => {
    const { response, body } = await createCampaign({
      audience_filter: {
        stage: ["invalid_stage"],
      },
    });

    expect(response.status).toBe(422);
    expect(body.error.fields.stage).toBeTruthy();
  });

  test("unknown audience filter key rejected", async () => {
    const { response } = await createCampaign({
      audience_filter: {
        stage: ["lead"],
        email_domain: "example.com",
      },
    });

    expect(response.status).toBe(400);
  });

  test("manual price rejected", async () => {
    const { response, body } = await createCampaign({
      body: "Produk tersedia dengan harga Rp100.000",
    });

    expect(response.status).toBe(422);
    expect(body.error.fields.body).toBeTruthy();
  });

  test("daily limit over 500 rejected", async () => {
    const { response } = await createCampaign({
      daily_limit: 501,
    });

    expect(response.status).toBe(422);
  });

  test("invalid campaign UUID rejected", async () => {
    const response = await call(
      "/api/kampanye/campaigns/not-a-uuid/preview",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(400);
  });
});

// ============================================================
// 5. DATE OUTPUT YYYY-MM-DD
// ============================================================

describe("Kampanye date serialization", () => {
  test("DATE projection is YYYY-MM-DD, not ISO datetime", async () => {
    const { response, body } = await createCampaign({
      scheduled_at: "2026-11-10T10:30:00.000Z",
    });

    expect(response.status).toBe(201);

    expect(body.data.scheduled_on).toBe("2026-11-10");

    expect(body.data.scheduled_on).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    expect(body.data.scheduled_on).not.toContain("T");

    // scheduled_at tetap merupakan timestamp.
    expect(body.data.scheduled_at).toBe(
      "2026-11-10T10:30:00.000Z",
    );
  });

  test("unscheduled campaign returns null date", async () => {
    const { body } = await createCampaign();

    expect(body.data.scheduled_on).toBeNull();
    expect(body.data.scheduled_at).toBeNull();
  });
});

// ============================================================
// 6. PREVIEW
// ============================================================

describe("Kampanye preview", () => {
  test("preview excludes archived, missing email and bounced", async () => {
    const goodId = await seedClinic({
      name: "Klinik Layak",
      email: "good@example.test",
    });

    await seedClinic({
      name: "Klinik Arsip",
      email: "archived@example.test",
      archived: true,
    });

    await seedClinic({
      name: "Klinik Tanpa Email",
      email: null,
    });

    await seedClinic({
      name: "Klinik Bounce",
      email: "bounce@example.test",
    });

    const db = await getDb();

    await db.query(
      `
        INSERT INTO email_suppressions (
          email,
          reason,
          source
        )
        VALUES (
          $1,
          'bounce',
          'test'
        )
      `,
      ["bounce@example.test"],
    );

    const created = await createCampaign();

    const response = await call(
      `/api/kampanye/campaigns/${created.body.data.id}/preview`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;

    expect(body.data.total).toBe(4);
    expect(body.data.eligible).toBe(1);
    expect(body.data.skipped).toBe(3);

    expect(
      body.data.examples.find(
        (item: any) => item.clinic_id === goodId,
      ).state,
    ).toBe("layak");

    expect(body.data.dry_run).toBe(true);
    expect(body.data.database_written).toBe(false);

    const recipients = await db.query(
      "SELECT count(*)::int AS total FROM campaign_recipients",
    );

    expect((recipients.rows[0] as any).total).toBe(0);
  });

  test("preview rejects nonexistent campaign", async () => {
    const response = await call(
      `/api/kampanye/campaigns/${crypto.randomUUID()}/preview`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(404);
  });
});

// ============================================================
// 7. SIMULATE
// ============================================================

describe("Kampanye simulate", () => {
  test("simulate creates dry-run recipients without sending", async () => {
    await seedClinic({
      name: "Klinik Satu",
      email: "one@example.test",
    });

    await seedClinic({
      name: "Klinik Dua",
      email: "two@example.test",
    });

    await seedClinic({
      name: "Klinik Tiga",
      email: "three@example.test",
    });

    const created = await createCampaign({
      daily_limit: 2,
    });

    const id = created.body.data.id;

    const response = await call(
      `/api/kampanye/campaigns/${id}/simulate`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;

    expect(body.data.simulated).toBe(2);
    expect(body.data.messages_sent).toBe(0);
    expect(body.data.external_calls).toBe(0);
    expect(body.data.dry_run).toBe(true);

    // Status tidak berubah menjadi selesai.
    expect(body.data.status).toBe("draft");

    const db = await getDb();

    const recipients = await db.query(
      `
        SELECT state, count(*)::int AS total
        FROM campaign_recipients
        WHERE campaign_id = $1
        GROUP BY state
      `,
      [id],
    );

    expect(recipients.rows).toEqual([
      {
        state: "terkirim_simulasi",
        total: 2,
      },
    ]);
  });

  test("second simulation does not duplicate recipients", async () => {
    await seedClinic({
      name: "Klinik Uji",
      email: "clinic@example.test",
    });

    const created = await createCampaign({
      daily_limit: 1,
    });

    const id = created.body.data.id;

    await call(
      `/api/kampanye/campaigns/${id}/simulate`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    const second = await call(
      `/api/kampanye/campaigns/${id}/simulate`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    const body = await second.json() as any;

    expect(body.data.simulated).toBe(0);
  });

  test("simulate does not change cancelled campaign", async () => {
    const created = await createCampaign({
      status: "dibatalkan",
    });

    const response = await call(
      `/api/kampanye/campaigns/${created.body.data.id}/simulate`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(409);
  });
});

// ============================================================
// 8. SUMMARY + 404
// ============================================================

describe("Kampanye summary dan not found", () => {
  test("summary returns counters", async () => {
    await createCampaign();

    const response = await call(
      "/api/kampanye/summary",
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;

    expect(body.data.total_campaigns).toBe(1);
    expect(body.data.campaigns_by_status.draft).toBe(1);
    expect(body.data.dry_run_only).toBe(true);
  });

  test("unknown route returns 404 envelope", async () => {
    const response = await call(
      "/api/kampanye/unknown",
    );

    expect(response.status).toBe(404);

    const body = (await response.json()) as any;

    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.request_id).toBeTruthy();
  });
});

// ============================================================
// 9. Tambahan Claude
// ============================================================

describe("Kampanye: tambahan Claude", () => {
  test("PATCH tetap bekerja saat jadwal lama sudah tersimpan (nilai Date dari DB)", async () => {
    const c = await createCampaign({ scheduled_at: "2026-11-10T10:30:00.000Z" });
    const r = await call(`/api/kampanye/campaigns/${c.body.data.id}`, { method: "PATCH", body: JSON.stringify({ daily_limit: 40 }) });
    expect(r.status).toBe(200);
    const b = (await r.json()) as any;
    expect(b.data.scheduled_at).toBe("2026-11-10T10:30:00.000Z");
    expect(b.data.daily_limit).toBe(40);
  });

  test("email diambil dari kontak utama bila kolom clinics.email kosong", async () => {
    const id = await seedClinic({ name: "Klinik Kontak", email: null });
    const db = await getDb();
    await db.query("INSERT INTO clinic_contacts (clinic_id, name, email, is_primary) VALUES ($1, 'PIC', 'pic@example.test', true)", [id]);
    const c = await createCampaign();
    const r = await call(`/api/kampanye/campaigns/${c.body.data.id}/preview`, { method: "POST", body: JSON.stringify({}) });
    const b = (await r.json()) as any;
    expect(b.data.eligible).toBe(1);
  });

  test("email kontak yang ada di daftar bounce tetap dilewati", async () => {
    const id = await seedClinic({ name: "Klinik Bounce Kontak", email: null });
    const db = await getDb();
    await db.query("INSERT INTO clinic_contacts (clinic_id, name, email, is_primary) VALUES ($1, 'PIC', 'bad@example.test', true)", [id]);
    await db.query("INSERT INTO email_suppressions (email, reason, source) VALUES ('BAD@example.test', 'bounce', 'test')");
    const c = await createCampaign();
    const r = await call(`/api/kampanye/campaigns/${c.body.data.id}/preview`, { method: "POST", body: JSON.stringify({}) });
    const b = (await r.json()) as any;
    expect(b.data.eligible).toBe(0);
    expect(b.data.examples[0].reason).toBe("email_bounce");
  });

  test("WhatsApp: hanya klinik bernomor, dan filter stage/wilayah bekerja", async () => {
    await seedClinic({ name: "A", phone: "0811", province: "Kalimantan Selatan", stage: "lead" });
    await seedClinic({ name: "B", phone: "0812", province: "Jawa Barat", stage: "lead" });
    await seedClinic({ name: "C", phone: null, province: "Kalimantan Selatan", stage: "lead" });
    await seedClinic({ name: "D", phone: "0813", province: "Kalimantan Selatan", stage: "active" });
    const c = await createCampaign({ channel: "whatsapp", audience_filter: { stage: ["lead"], region: ["Kalimantan Selatan"] } });
    const r = await call(`/api/kampanye/campaigns/${c.body.data.id}/preview`, { method: "POST", body: JSON.stringify({}) });
    const b = (await r.json()) as any;
    expect(b.data.total).toBe(2);
    expect(b.data.eligible).toBe(1);
    const s = await call(`/api/kampanye/campaigns/${c.body.data.id}/simulate`, { method: "POST", body: JSON.stringify({}) });
    expect(((await s.json()) as any).data.simulated).toBe(1);
  });

  test("pencarian q memperlakukan % sebagai teks biasa", async () => {
    await createCampaign({ name: "Promo A" });
    const r = await call("/api/kampanye/campaigns?q=%25");
    expect(((await r.json()) as any).data.length).toBe(0);
  });

  test("tidak ada panggilan jaringan keluar dari route kampanye", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/routes/kampanye/index.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/fetch\(|resend|api\.whatsapp|XMLHttpRequest|WebSocket/i);
  });
});
