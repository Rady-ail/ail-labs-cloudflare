import { Hono } from "hono";

import type { AppEnv } from "../../lib/http";

import {
  ValidationError,
  ok,
  created,
  fail,
} from "../../lib/http";

import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";
import { readJsonObject } from "../../lib/body";

import {
  isUuid,
  clampInt,
} from "../../lib/validate";

const kampanyeRoutes = new Hono<AppEnv>();

// ============================================================
// CONSTANTS
// ============================================================

const CHANNELS = [
  "email",
  "whatsapp",
] as const;

const STATUSES = [
  "draft",
  "siap",
  "dijadwalkan",
  "selesai",
  "dibatalkan",
] as const;

const RECIPIENT_STATES = [
  "antre",
  "dilewati",
  "terkirim_simulasi",
] as const;

const CLINIC_STAGES = [
  "lead",
  "contacted",
  "catalog_sent",
  "negotiating",
  "ordered",
  "active",
  "inactive",
] as const;

const CREATE_FIELDS = [
  "name",
  "channel",
  "status",
  "subject",
  "body",
  "product_ids",
  "audience_filter",
  "scheduled_at",
  "daily_limit",
] as const;

const UPDATE_FIELDS = CREATE_FIELDS;

type Channel = typeof CHANNELS[number];
type CampaignStatus = typeof STATUSES[number];

type AudienceFilter = {
  stage?: string[];
  region?: string[];
};

type CampaignInput = {
  name: string;
  channel: Channel;
  status: CampaignStatus;
  subject: string | null;
  body: string;
  product_ids: string[];
  audience_filter: AudienceFilter;
  scheduled_at: string | null;
  daily_limit: number;
};

// ============================================================
// ERROR HELPERS
// ============================================================

function bad(
  message: string,
  fields?: Record<string, string>,
): never {
  throw new ValidationError(
    "BAD_REQUEST",
    message,
    fields ? { fields } : undefined,
  );
}

function invalid(
  message: string,
  fields: Record<string, string>,
): never {
  throw new ValidationError(
    "VALIDATION_ERROR",
    message,
    { fields },
  );
}

function unknownFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const set = new Set(allowed);

  const unknown = Object.keys(input).filter(
    (key) => !set.has(key),
  );

  if (unknown.length) {
    bad(
      "Field tidak dikenal.",
      Object.fromEntries(
        unknown.map((key) => [
          key,
          "Field tidak dikenal.",
        ]),
      ),
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as Record<string, unknown>;

  if (value.code === "23505") {
    return true;
  }

  const cause = value.cause;

  return Boolean(
    cause
    && typeof cause === "object"
    && (cause as Record<string, unknown>).code === "23505",
  );
}

function duplicateResponse(c: Parameters<typeof fail>[0]) {
  return fail(
    c,
    409,
    "CAMPAIGN_DUPLICATE",
    "Nama kampanye sudah digunakan.",
  );
}

// ============================================================
// DATE SERIALIZATION
// ============================================================

function iso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date
    ? value
    : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

/**
 * DATE PostgreSQL harus dikembalikan sebagai YYYY-MM-DD.
 * Tidak mengubah nilai DATE menjadi ISO datetime.
 */
function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);

    if (match) {
      return match[1];
    }
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return null;
}

function campaignOut(row: Record<string, any>) {
  return {
    ...row,
    scheduled_at: iso(row.scheduled_at),
    scheduled_on: dateOnly(row.scheduled_on),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function recipientOut(row: Record<string, any>) {
  return {
    ...row,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

// ============================================================
// VALIDATION
// ============================================================

function validateChannel(value: unknown): Channel {
  if (
    typeof value !== "string"
    || !CHANNELS.includes(value as Channel)
  ) {
    invalid("Channel tidak valid.", {
      channel: "Gunakan email atau whatsapp.",
    });
  }

  return value as Channel;
}

function validateStatus(value: unknown): CampaignStatus {
  if (
    typeof value !== "string"
    || !STATUSES.includes(value as CampaignStatus)
  ) {
    invalid("Status kampanye tidak valid.", {
      status: "Status tidak dikenal.",
    });
  }

  return value as CampaignStatus;
}

function validateText(
  value: unknown,
  key: string,
  required: boolean,
  max: number,
): string | null {
  if (value === null && !required) {
    return null;
  }

  if (typeof value !== "string") {
    if (!required && value === undefined) {
      return null;
    }

    invalid("Data kampanye tidak valid.", {
      [key]: "Harus berupa teks.",
    });
  }

  const result = value.trim();

  if (required && !result) {
    invalid("Data kampanye tidak valid.", {
      [key]: "Field wajib diisi.",
    });
  }

  if (result.length > max) {
    invalid("Data kampanye tidak valid.", {
      [key]: `Maksimal ${max} karakter.`,
    });
  }

  return result || null;
}

/**
 * Kebijakan konservatif:
 * harga tidak boleh ditulis manual di body kampanye.
 * Modul ini tidak melakukan interpolasi harga.
 * Jika fitur harga ditambahkan kemudian, sumbernya wajib
 * catalog_products.harga atau catalog_products.harga_asli.
 */
function validateBody(value: unknown): string {
  const body = validateText(
    value,
    "body",
    true,
    30000,
  );

  if (!body) {
    invalid("Body kampanye wajib diisi.", {
      body: "Body wajib diisi.",
    });
  }

  const pricePattern =
    /\b(?:rp\.?|idr)\s*[\d.,]+|\b[\d.,]+\s*(?:rp\.?|idr)\b/i;

  if (pricePattern.test(body)) {
    invalid(
      "Harga manual tidak diizinkan dalam body kampanye.",
      {
        body: "Jangan memasukkan nominal harga manual.",
      },
    );
  }

  return body;
}

function validateProductIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    invalid("Daftar produk tidak valid.", {
      product_ids: "Maksimal 100 UUID produk.",
    });
  }

  const ids: string[] = [];

  for (const item of value) {
    if (!isUuid(item)) {
      invalid("Daftar produk tidak valid.", {
        product_ids: "Setiap ID produk harus UUID.",
      });
    }

    if (ids.includes(item)) {
      invalid("Daftar produk duplikat.", {
        product_ids: "ID produk tidak boleh berulang.",
      });
    }

    ids.push(item);
  }

  return ids;
}

function validateAudienceFilter(
  value: unknown,
): AudienceFilter {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    invalid("Audience filter tidak valid.", {
      audience_filter: "Harus berupa objek.",
    });
  }

  const input = value as Record<string, unknown>;

  unknownFields(input, [
    "stage",
    "region",
  ]);

  const output: AudienceFilter = {};

  for (const key of ["stage", "region"] as const) {
    if (!(key in input)) continue;

    const raw = input[key];

    const values = Array.isArray(raw)
      ? raw
      : [raw];

    if (
      values.length === 0
      || values.length > 50
      || values.some(
        (item) =>
          typeof item !== "string"
          || !item.trim()
          || item.length > 100,
      )
    ) {
      invalid("Audience filter tidak valid.", {
        [key]: "Gunakan 1–50 nilai teks.",
      });
    }

    const normalized = [
      ...new Set(
        (values as string[]).map((item) => item.trim()),
      ),
    ];

    if (
      key === "stage"
      && normalized.some(
        (item) =>
          !CLINIC_STAGES.includes(
            item as typeof CLINIC_STAGES[number],
          ),
      )
    ) {
      invalid("Stage filter tidak valid.", {
        stage: "Stage tidak terdapat dalam allowlist CRM.",
      });
    }

    output[key] = normalized;
  }

  return output;
}

function validateScheduledAt(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      invalid("Waktu jadwal tidak valid.", {
        scheduled_at: "Tanggal tidak valid.",
      });
    }

    return value.toISOString();
  }

  if (
    typeof value !== "string"
    || !value.includes("T")
    || Number.isNaN(Date.parse(value))
  ) {
    invalid("Waktu jadwal tidak valid.", {
      scheduled_at: "Gunakan ISO 8601 datetime.",
    });
  }

  return new Date(value).toISOString();
}

function validateDailyLimit(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 1
    || value > 500
  ) {
    invalid("Batas harian tidak valid.", {
      daily_limit: "Gunakan bilangan bulat 1–500.",
    });
  }

  return value;
}

function validateCampaign(
  input: Record<string, unknown>,
): CampaignInput {
  unknownFields(input, CREATE_FIELDS);

  const name = validateText(
    input.name,
    "name",
    true,
    160,
  );

  const channel = validateChannel(input.channel);

  const status = input.status === undefined
    ? "draft"
    : validateStatus(input.status);

  const subject = validateText(
    input.subject,
    "subject",
    false,
    300,
  );

  const body = validateBody(input.body);

  const product_ids = validateProductIds(
    input.product_ids ?? [],
  );

  const audience_filter = validateAudienceFilter(
    input.audience_filter ?? {},
  );

  const scheduled_at = validateScheduledAt(
    input.scheduled_at,
  );

  const daily_limit = input.daily_limit === undefined
    ? 150
    : validateDailyLimit(input.daily_limit);

  return {
    name: name!,
    channel,
    status,
    subject,
    body,
    product_ids,
    audience_filter,
    scheduled_at,
    daily_limit,
  };
}

// ============================================================
// PRODUCT EXISTENCE VALIDATION
// ============================================================

async function assertProductsExist(
  sql: ReturnType<typeof getSql>,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;

  const rows = await sql`
    SELECT id
    FROM catalog_products
    WHERE id = ANY(${ids}::uuid[])
  `;

  const existing = new Set(
    rows.map((row: Record<string, unknown>) => String(row.id)),
  );

  const missing = ids.filter((id) => !existing.has(id));

  if (missing.length) {
    invalid("Produk kampanye tidak ditemukan.", {
      product_ids: "Satu atau lebih produk tidak tersedia.",
    });
  }
}

// ============================================================
// CAMPAIGN QUERY
// ============================================================

async function findCampaign(
  sql: ReturnType<typeof getSql>,
  id: string,
) {
  const rows = await sql`
    SELECT
      c.*,
      to_char(
        c.scheduled_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD'
      ) AS scheduled_on
    FROM campaigns c
    WHERE c.id = ${id}
    LIMIT 1
  `;

  return rows[0] as Record<string, any> | undefined;
}

function audienceArrays(filter: AudienceFilter) {
  return {
    stages: filter.stage ?? null,
    regions: filter.region ?? null,
  };
}

// ============================================================
// GET /campaigns
// ============================================================

kampanyeRoutes.get("/campaigns", async (c) => {
  const query = c.req.query();

  const allowed = new Set([
    "status",
    "channel",
    "q",
    "limit",
    "page",
  ]);

  const unknown = Object.keys(query).filter(
    (key) => !allowed.has(key),
  );

  if (unknown.length) {
    bad(
      "Parameter tidak dikenal.",
      Object.fromEntries(
        unknown.map((key) => [
          key,
          "Parameter tidak dikenal.",
        ]),
      ),
    );
  }

  if (
    query.status
    && !STATUSES.includes(query.status as CampaignStatus)
  ) {
    bad("Filter status tidak valid.");
  }

  if (
    query.channel
    && !CHANNELS.includes(query.channel as Channel)
  ) {
    bad("Filter channel tidak valid.");
  }

  if (query.q && query.q.length > 160) {
    bad("Parameter q maksimal 160 karakter.");
  }

  if (
    query.limit !== undefined
    && !/^\d+$/.test(query.limit)
  ) {
    bad("limit harus berupa angka.");
  }

  if (
    query.page !== undefined
    && !/^\d+$/.test(query.page)
  ) {
    bad("page harus berupa angka.");
  }

  const limit = clampInt(query.limit, 1, 200, 50);
  const page = clampInt(query.page, 1, 1000000, 1);
  const offset = (page - 1) * limit;

  const status = query.status ?? null;
  const channel = query.channel ?? null;
  const search = query.q?.trim() || null;
  const pattern = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : null;

  const sql = getSql(c.env);

  const [rows, count] = await Promise.all([
    sql`
      SELECT
        c.*,
        to_char(
          c.scheduled_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD'
        ) AS scheduled_on
      FROM campaigns c
      WHERE
        (${status}::text IS NULL OR c.status = ${status})
        AND (${channel}::text IS NULL OR c.channel = ${channel})
        AND (
          ${pattern}::text IS NULL
          OR c.name ILIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY c.created_at DESC, c.id
      LIMIT ${limit}
      OFFSET ${offset}
    `,

    sql`
      SELECT count(*)::int AS total
      FROM campaigns c
      WHERE
        (${status}::text IS NULL OR c.status = ${status})
        AND (${channel}::text IS NULL OR c.channel = ${channel})
        AND (
          ${pattern}::text IS NULL
          OR c.name ILIKE ${pattern} ESCAPE '\\'
        )
    `,
  ]);

  const total = Number(count[0]?.total ?? 0);

  return ok(
    c,
    rows.map((row: Record<string, any>) => campaignOut(row)),
    {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  );
});

// ============================================================
// POST /campaigns
// ============================================================

kampanyeRoutes.post("/campaigns", async (c) => {
  const body = await readJsonObject(c);

  const input = validateCampaign(body);

  const sql = getSql(c.env);

  await assertProductsExist(sql, input.product_ids);

  try {
    const rows = await sql`
      INSERT INTO campaigns (
        name,
        channel,
        status,
        subject,
        body,
        product_ids,
        audience_filter,
        scheduled_at,
        daily_limit
      )
      VALUES (
        ${input.name},
        ${input.channel},
        ${input.status},
        ${input.subject},
        ${input.body},
        ${input.product_ids}::uuid[],
        ${JSON.stringify(input.audience_filter)}::jsonb,
        ${input.scheduled_at}::timestamptz,
        ${input.daily_limit}
      )
      RETURNING *
    `;

    const row = rows[0] as Record<string, any>;

    await audit(sql, {
      actor: c.get("actor"),
      action: "kampanye.create",
      resourceType: "campaign",
      resourceId: String(row.id),
      requestId: c.get("requestId"),
      ok: true,
    });

    return created(
      c,
      campaignOut({
        ...row,
        scheduled_on: row.scheduled_at
          ? new Date(row.scheduled_at).toISOString().slice(0, 10)
          : null,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateResponse(c);
    }

    throw error;
  }
});

// ============================================================
// PATCH /campaigns/:id
// ============================================================

kampanyeRoutes.patch("/campaigns/:id", async (c) => {
  const id = c.req.param("id");

  if (!isUuid(id)) {
    bad("ID kampanye tidak valid.");
  }

  const body = await readJsonObject(c);

  unknownFields(body, UPDATE_FIELDS);

  if (Object.keys(body).length === 0) {
    bad("Minimal satu field harus diperbarui.");
  }

  const sql = getSql(c.env);

  const existing = await findCampaign(sql, id);

  if (!existing) {
    return fail(
      c,
      404,
      "CAMPAIGN_NOT_FOUND",
      "Kampanye tidak ditemukan.",
    );
  }

  const merged = {
    name: body.name ?? existing.name,
    channel: body.channel ?? existing.channel,
    status: body.status ?? existing.status,
    subject: Object.hasOwn(body, "subject")
      ? body.subject
      : existing.subject,
    body: body.body ?? existing.body,
    product_ids: body.product_ids ?? existing.product_ids,
    audience_filter: body.audience_filter ?? existing.audience_filter,
    scheduled_at: Object.hasOwn(body, "scheduled_at")
      ? body.scheduled_at
      : existing.scheduled_at,
    daily_limit: body.daily_limit ?? existing.daily_limit,
  };

  const input = validateCampaign(merged);

  await assertProductsExist(sql, input.product_ids);

  try {
    const rows = await sql`
      UPDATE campaigns
      SET
        name = ${input.name},
        channel = ${input.channel},
        status = ${input.status},
        subject = ${input.subject},
        body = ${input.body},
        product_ids = ${input.product_ids}::uuid[],
        audience_filter = ${JSON.stringify(input.audience_filter)}::jsonb,
        scheduled_at = ${input.scheduled_at}::timestamptz,
        daily_limit = ${input.daily_limit},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!rows[0]) {
      return fail(
        c,
        404,
        "CAMPAIGN_NOT_FOUND",
        "Kampanye tidak ditemukan.",
      );
    }

    const row = rows[0] as Record<string, any>;

    await audit(sql, {
      actor: c.get("actor"),
      action: "kampanye.update",
      resourceType: "campaign",
      resourceId: id,
      requestId: c.get("requestId"),
      ok: true,
    });

    return ok(
      c,
      campaignOut({
        ...row,
        scheduled_on: row.scheduled_at
          ? new Date(row.scheduled_at).toISOString().slice(0, 10)
          : null,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateResponse(c);
    }

    throw error;
  }
});

// ============================================================
// AUDIENCE SQL
// ============================================================

function audienceCte(
  channel: Channel,
  stages: string[] | null,
  regions: string[] | null,
) {
  return {
    channel,
    stages,
    regions,
  };
}

// ============================================================
// POST /campaigns/:id/preview
// ============================================================

kampanyeRoutes.post(
  "/campaigns/:id/preview",
  async (c) => {
    const id = c.req.param("id");

    if (!isUuid(id)) {
      bad("ID kampanye tidak valid.");
    }

    const body = await readJsonObject(c);

    if (Object.keys(body).length > 0) {
      bad("Preview tidak menerima parameter tambahan.");
    }

    const sql = getSql(c.env);

    const campaign = await findCampaign(sql, id);

    if (!campaign) {
      return fail(
        c,
        404,
        "CAMPAIGN_NOT_FOUND",
        "Kampanye tidak ditemukan.",
      );
    }

    const filter = campaign.audience_filter as AudienceFilter;
    const audience = audienceCte(
      campaign.channel as Channel,
      filter.stage ?? null,
      filter.region ?? null,
    );

    const [counts, examples] = await Promise.all([
      sql`
        WITH audience AS (
          SELECT
            c.id,
            CASE
              WHEN c.archived = true
                THEN 'klinik_arsip'

              WHEN ${audience.channel} = 'email'
                AND NULLIF(trim((COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1)))), '') IS NULL
                THEN 'tanpa_email'

              WHEN ${audience.channel} = 'email'
                AND EXISTS (
                  SELECT 1
                  FROM email_suppressions es
                  WHERE lower(es.email) = lower((COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1))))
                )
                THEN 'email_bounce'

              WHEN ${audience.channel} = 'whatsapp'
                AND NULLIF(trim(c.phone), '') IS NULL
                THEN 'tanpa_nomor'

              ELSE NULL
            END AS skip_reason
          FROM clinics c
          WHERE
            (
              ${audience.stages}::text[] IS NULL
              OR c.stage = ANY(${audience.stages}::text[])
            )
            AND (
              ${audience.regions}::text[] IS NULL
              OR c.province = ANY(${audience.regions}::text[])
            )
        )
        SELECT
          count(*)::int AS total,
          count(*) FILTER (
            WHERE skip_reason IS NULL
          )::int AS eligible,
          count(*) FILTER (
            WHERE skip_reason IS NOT NULL
          )::int AS skipped
        FROM audience
      `,

      sql`
        SELECT
          c.id AS clinic_id,
          c.name,
          c.province,
          c.stage,
          CASE
            WHEN c.archived = true
              THEN 'klinik_arsip'

            WHEN ${audience.channel} = 'email'
              AND NULLIF(trim((COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1)))), '') IS NULL
              THEN 'tanpa_email'

            WHEN ${audience.channel} = 'email'
              AND EXISTS (
                SELECT 1
                FROM email_suppressions es
                WHERE lower(es.email) = lower((COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1))))
              )
              THEN 'email_bounce'

            WHEN ${audience.channel} = 'whatsapp'
              AND NULLIF(trim(c.phone), '') IS NULL
              THEN 'tanpa_nomor'

            ELSE NULL
          END AS skip_reason
        FROM clinics c
        WHERE
          (
            ${audience.stages}::text[] IS NULL
            OR c.stage = ANY(${audience.stages}::text[])
          )
          AND (
            ${audience.regions}::text[] IS NULL
            OR c.province = ANY(${audience.regions}::text[])
          )
        ORDER BY c.created_at, c.id
        LIMIT 20
      `,
    ]);

    const totals = counts[0];

    return ok(c, {
      campaign_id: id,
      channel: campaign.channel,

      total: Number(totals?.total ?? 0),
      eligible: Number(totals?.eligible ?? 0),
      skipped: Number(totals?.skipped ?? 0),

      examples: examples.map(
        (row: Record<string, any>) => ({
          clinic_id: row.clinic_id,
          name: row.name,
          province: row.province,
          stage: row.stage,
          state: row.skip_reason
            ? "dilewati"
            : "layak",
          reason: row.skip_reason,
        }),
      ),

      dry_run: true,
      database_written: false,
    });
  },
);

// ============================================================
// POST /campaigns/:id/simulate
// ============================================================

kampanyeRoutes.post(
  "/campaigns/:id/simulate",
  async (c) => {
    const id = c.req.param("id");

    if (!isUuid(id)) {
      bad("ID kampanye tidak valid.");
    }

    const body = await readJsonObject(c);

    if (Object.keys(body).length > 0) {
      bad("Simulate tidak menerima parameter tambahan.");
    }

    const sql = getSql(c.env);

    const campaign = await findCampaign(sql, id);

    if (!campaign) {
      return fail(
        c,
        404,
        "CAMPAIGN_NOT_FOUND",
        "Kampanye tidak ditemukan.",
      );
    }

    if (
      campaign.status === "dibatalkan"
      || campaign.status === "selesai"
    ) {
      return fail(
        c,
        409,
        "CAMPAIGN_NOT_SIMULATABLE",
        "Kampanye dibatalkan atau selesai tidak dapat disimulasikan.",
      );
    }

    const filter = campaign.audience_filter as AudienceFilter;

    const stages = filter.stage ?? null;
    const regions = filter.region ?? null;

    const rows = await sql`
      WITH eligible AS (
        SELECT
          c.id AS clinic_id,
          row_number() OVER (
            ORDER BY c.created_at ASC, c.id ASC
          ) AS position
        FROM clinics c
        WHERE
          c.archived = false

          AND (
            ${stages}::text[] IS NULL
            OR c.stage = ANY(${stages}::text[])
          )

          AND (
            ${regions}::text[] IS NULL
            OR c.province = ANY(${regions}::text[])
          )

          AND (
            (
              ${campaign.channel} = 'email'
              AND NULLIF(trim((COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1)))), '') IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM email_suppressions es
                WHERE lower(es.email) = lower((COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1))))
              )
            )
            OR
            (
              ${campaign.channel} = 'whatsapp'
              AND NULLIF(trim(c.phone), '') IS NOT NULL
            )
          )

          AND NOT EXISTS (
            SELECT 1
            FROM campaign_recipients cr
            WHERE cr.campaign_id = ${id}::uuid
              AND cr.clinic_id = c.id
          )
      ),

      inserted AS (
        INSERT INTO campaign_recipients (
          campaign_id,
          clinic_id,
          state,
          reason
        )
        SELECT
          ${id}::uuid,
          eligible.clinic_id,
          'terkirim_simulasi',
          'DRY-RUN: tidak ada pesan yang dikirim.'
        FROM eligible
        WHERE eligible.position <= ${campaign.daily_limit}
        ON CONFLICT (campaign_id, clinic_id)
        DO NOTHING
        RETURNING id
      )

      SELECT count(*)::int AS simulated
      FROM inserted
    `;

    const simulated = Number(rows[0]?.simulated ?? 0);

    if (simulated > 0) {
      await audit(sql, {
        actor: c.get("actor"),
        action: "kampanye.simulate",
        resourceType: "campaign",
        resourceId: id,
        requestId: c.get("requestId"),
        ok: true,
      });
    }

    // Status kampanye tidak diubah.
    return ok(c, {
      campaign_id: id,
      simulated,
      daily_limit: campaign.daily_limit,
      status: campaign.status,
      dry_run: true,
      messages_sent: 0,
      external_calls: 0,
    });
  },
);

// ============================================================
// GET /summary
// ============================================================

kampanyeRoutes.get("/summary", async (c) => {
  if (Object.keys(c.req.query()).length > 0) {
    bad("Summary tidak menerima parameter.");
  }

  const sql = getSql(c.env);

  const [campaigns, recipients] = await Promise.all([
    sql`
      SELECT
        status,
        count(*)::int AS total
      FROM campaigns
      GROUP BY status
      ORDER BY status
    `,

    sql`
      SELECT
        state,
        count(*)::int AS total
      FROM campaign_recipients
      GROUP BY state
      ORDER BY state
    `,
  ]);

  const byStatus: Record<string, number> =
    Object.fromEntries(
      STATUSES.map((status) => [status, 0]),
    );

  const byRecipientState: Record<string, number> =
    Object.fromEntries(
      RECIPIENT_STATES.map((state) => [state, 0]),
    );

  for (const row of campaigns) {
    byStatus[String(row.status)] = Number(row.total);
  }

  for (const row of recipients) {
    byRecipientState[String(row.state)] = Number(row.total);
  }

  return ok(c, {
    campaigns_by_status: byStatus,
    recipients_by_state: byRecipientState,

    total_campaigns: Object.values(byStatus).reduce(
      (sum, value) => sum + value,
      0,
    ),

    total_recipients: Object.values(byRecipientState).reduce(
      (sum, value) => sum + value,
      0,
    ),

    dry_run_only: true,
  });
});

// ============================================================
// DAFTAR KIRIM MANUAL (WhatsApp dan Email/Gmail)
// Aplikasi hanya menampilkan daftar dan mencatat tanda "sudah dikirim".
// Tidak ada pengiriman pesan dan tidak ada panggilan eksternal.
// ============================================================

async function loadCampaignForManual(c: any, sql: any, id: string) {
  if (!isUuid(id)) bad("ID kampanye tidak valid.");
  const campaign = await findCampaign(sql, id);
  if (!campaign) {
    return { error: fail(c, 404, "CAMPAIGN_NOT_FOUND", "Kampanye tidak ditemukan.") };
  }
  return { campaign };
}

// Penerima layak: klinik tidak diarsip, punya kontak untuk saluran, cocok filter, dan (email) tidak ada di daftar bounce.
function recipientBase(sql: any, campaign: Record<string, any>) {
  const filter = campaign.audience_filter as AudienceFilter;
  const stages = filter.stage ?? null;
  const regions = filter.region ?? null;
  const channel = String(campaign.channel);
  return { stages, regions, channel, sql };
}

kampanyeRoutes.get("/campaigns/:id/recipients", async (c) => {
  const q = c.req.query();
  const unknown = Object.keys(q).filter((k) => !["page", "limit"].includes(k));
  if (unknown.length) {
    bad("Parameter tidak dikenal.", Object.fromEntries(unknown.map((k) => [k, "Parameter tidak dikenal."])));
  }
  const page = clampInt(q.page, 1, 100000, 1);
  const limit = clampInt(q.limit, 1, 200, 100);
  const sql = getSql(c.env);
  const loaded = await loadCampaignForManual(c, sql, c.req.param("id"));
  if (loaded.error) return loaded.error;
  const campaign = loaded.campaign as Record<string, any>;
  const { stages, regions, channel } = recipientBase(sql, campaign);
  const offset = (page - 1) * limit;

  const [rows, totals] = await Promise.all([
    sql`
      WITH base AS (
        SELECT c.id, c.name, c.province, c.stage, c.created_at,
          CASE WHEN ${channel}::text = 'email'
            THEN (COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1)))
            ELSE NULLIF(trim(c.phone), '') END AS contact
        FROM clinics c
        WHERE c.archived = false
          AND (${stages}::text[] IS NULL OR c.stage = ANY(${stages}::text[]))
          AND (${regions}::text[] IS NULL OR c.province = ANY(${regions}::text[]))
      )
      SELECT b.id AS clinic_id, b.name, b.province, b.stage, b.contact,
             COALESCE(r.state, 'belum') AS state, r.updated_at AS marked_at
      FROM base b
      LEFT JOIN campaign_recipients r ON r.clinic_id = b.id AND r.campaign_id = ${campaign.id}
      WHERE b.contact IS NOT NULL
        AND NOT (${channel}::text = 'email' AND EXISTS (SELECT 1 FROM email_suppressions es WHERE lower(es.email) = lower(b.contact)))
      ORDER BY (r.state = 'terkirim_manual') ASC NULLS FIRST, b.created_at ASC, b.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
    sql`
      WITH base AS (
        SELECT c.id,
          CASE WHEN ${channel}::text = 'email'
            THEN (COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1)))
            ELSE NULLIF(trim(c.phone), '') END AS contact
        FROM clinics c
        WHERE c.archived = false
          AND (${stages}::text[] IS NULL OR c.stage = ANY(${stages}::text[]))
          AND (${regions}::text[] IS NULL OR c.province = ANY(${regions}::text[]))
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE r.state = 'terkirim_manual')::int AS sent_total,
        count(*) FILTER (
          WHERE r.state = 'terkirim_manual'
            AND (r.updated_at AT TIME ZONE 'Asia/Makassar')::date = (now() AT TIME ZONE 'Asia/Makassar')::date
        )::int AS sent_today
      FROM base b
      LEFT JOIN campaign_recipients r ON r.clinic_id = b.id AND r.campaign_id = ${campaign.id}
      WHERE b.contact IS NOT NULL
        AND NOT (${channel}::text = 'email' AND EXISTS (SELECT 1 FROM email_suppressions es WHERE lower(es.email) = lower(b.contact)))
    `,
  ]);
  const t = totals[0] ?? { total: 0, sent_total: 0, sent_today: 0 };
  return ok(
    c,
    rows.map((r: Record<string, any>) => ({
      clinic_id: String(r.clinic_id),
      name: r.name,
      province: r.province,
      stage: r.stage,
      phone: channel === "whatsapp" ? r.contact : null,
      email: channel === "email" ? r.contact : null,
      state: r.state,
      marked_at: r.state === "terkirim_manual" ? iso(r.marked_at) : null,
    })),
    {
      page,
      limit,
      channel,
      total: Number(t.total),
      total_pages: Math.ceil(Number(t.total) / limit),
      sent_total: Number(t.sent_total),
      sent_today: Number(t.sent_today),
      daily_limit: campaign.daily_limit,
      messages_sent_by_app: 0,
    },
  );
});

kampanyeRoutes.put("/campaigns/:id/recipients/:clinicId", async (c) => {
  const clinicId = c.req.param("clinicId");
  if (!isUuid(clinicId)) bad("ID klinik tidak valid.");
  const body = await readJsonObject(c);
  unknownFields(body, ["state"]);
  if (body.state !== "terkirim_manual" && body.state !== "antre") {
    invalid("State tidak valid.", { state: "Gunakan terkirim_manual atau antre." });
  }
  const state = body.state as string;
  const sql = getSql(c.env);
  const loaded = await loadCampaignForManual(c, sql, c.req.param("id"));
  if (loaded.error) return loaded.error;
  const campaign = loaded.campaign as Record<string, any>;
  if (campaign.status === "dibatalkan") {
    return fail(c, 409, "CAMPAIGN_CLOSED", "Kampanye dibatalkan tidak dapat diubah.");
  }
  const { stages, regions, channel } = recipientBase(sql, campaign);

  const eligible = await sql`
    WITH base AS (
      SELECT c.id,
        CASE WHEN ${channel}::text = 'email'
          THEN (COALESCE(NULLIF(trim(c.email), ''), (SELECT NULLIF(trim(cc.email), '') FROM clinic_contacts cc WHERE cc.clinic_id = c.id AND NULLIF(trim(cc.email), '') IS NOT NULL ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1)))
          ELSE NULLIF(trim(c.phone), '') END AS contact
      FROM clinics c
      WHERE c.id = ${clinicId} AND c.archived = false
        AND (${stages}::text[] IS NULL OR c.stage = ANY(${stages}::text[]))
        AND (${regions}::text[] IS NULL OR c.province = ANY(${regions}::text[]))
    )
    SELECT b.id FROM base b
    WHERE b.contact IS NOT NULL
      AND NOT (${channel}::text = 'email' AND EXISTS (SELECT 1 FROM email_suppressions es WHERE lower(es.email) = lower(b.contact)))
  `;
  if (!eligible.length) {
    return fail(c, 404, "RECIPIENT_NOT_FOUND", "Klinik tidak ada di daftar penerima kampanye ini.");
  }
  await sql`
    INSERT INTO campaign_recipients (campaign_id, clinic_id, state)
    VALUES (${campaign.id}, ${clinicId}, ${state})
    ON CONFLICT (campaign_id, clinic_id)
    DO UPDATE SET state = EXCLUDED.state, reason = NULL, updated_at = now()
  `;
  await audit(sql, {
    actor: c.get("actor"),
    action: state === "terkirim_manual" ? "kampanye.recipient.mark_sent" : "kampanye.recipient.unmark",
    resourceType: "campaign",
    resourceId: String(campaign.id),
    requestId: c.get("requestId"),
    ok: true,
  });
  return ok(c, { campaign_id: String(campaign.id), clinic_id: clinicId, state, messages_sent_by_app: 0 });
});

export { kampanyeRoutes };
