import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError, fail, created, ok } from "../../lib/http";
import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";
import { readJsonObject } from "../../lib/body";
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  sampleCreateSchema,
  sampleUpdateSchema,
  importSchema,
  parseSchema,
  validateSupplierCreate,
  validateSupplierUpdate,
  validateSampleCreate,
  validateSampleUpdate,
  isSupplierSlugBlocked,
  isUuid,
  SUPPLIER_CATEGORIES,
  SUPPLIER_STATUSES,
} from "./supplierModel";

const routes = new Hono<AppEnv>();

const ALLOWED_QUERY = new Set([
  "status",
  "category",
  "q",
  "include_archived",
]);

const CREATE_COLUMNS = [
  "slug",
  "name",
  "country",
  "contact",
  "channel",
  "category",
  "status",
  "terms",
  "note",
  "last_activity_on",
] as const;

const UPDATE_COLUMNS = CREATE_COLUMNS;

function badRequest(message: string): never {
  throw new ValidationError("BAD_REQUEST", message);
}

function checkId(value: string): string {
  if (!isUuid(value)) badRequest("ID tidak valid.");
  return value;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const date = value instanceof Date
    ? value
    : new Date(String(value));

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function auditActor(actor: string): string {
  return actor === "owner" ? "owner" : "access";
}

async function recordAudit(
  c: Parameters<typeof audit>[0] extends never
    ? never
    : any,
  sql: ReturnType<typeof getSql>,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await audit(sql, {
    actor: auditActor(c.get("actor")),
    action,
    resourceType,
    resourceId,
    requestId: c.get("requestId"),
    ok: true,
  });
}

async function supplierExists(
  sql: ReturnType<typeof getSql>,
  id: string,
): Promise<boolean> {
  const rows = await sql`
    SELECT id
    FROM suppliers
    WHERE id = ${id}
    AND archived_at IS NULL
    LIMIT 1
  `;

  return rows.length > 0;
}

function normalizeSupplierRow(row: Record<string, any>) {
  return {
    ...row,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    archived_at: iso(row.archived_at),
  };
}

function normalizeSampleRow(row: Record<string, any>) {
  return {
    ...row,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

// ---------------------------------------------------------
// GET /suppliers
// ---------------------------------------------------------

routes.get("/suppliers", async (c) => {
  const query = c.req.query();

  const unknown = Object.keys(query).filter(
    (key) => !ALLOWED_QUERY.has(key),
  );

  if (unknown.length) {
    throw new ValidationError(
      "BAD_REQUEST",
      "Parameter tidak dikenal.",
      {
        fields: Object.fromEntries(
          unknown.map((key) => [key, "Parameter tidak dikenal."]),
        ),
      },
    );
  }

  const status = query.status || null;
  const category = query.category || null;
  const q = query.q?.trim() || null;

  if (
    status !== null
    && !(SUPPLIER_STATUSES as readonly string[]).includes(status)
  ) {
    badRequest("Filter status tidak valid.");
  }

  if (
    category !== null
    && !(SUPPLIER_CATEGORIES as readonly string[]).includes(category)
  ) {
    badRequest("Filter kategori tidak valid.");
  }

  const includeArchived = query.include_archived ?? "0";

  if (!["0", "1"].includes(includeArchived)) {
    badRequest("include_archived harus 0 atau 1.");
  }

  const pattern = q ? `%${escapeLike(q)}%` : null;
  const sql = getSql(c.env);

  const rows = await sql`
    SELECT s.*
    FROM suppliers s
    WHERE
      (${includeArchived === "1"}::boolean = true
        OR s.archived_at IS NULL)
      AND (${status}::text IS NULL OR s.status = ${status})
      AND (${category}::text IS NULL OR s.category = ${category})
      AND (
        ${pattern}::text IS NULL
        OR s.name ILIKE ${pattern} ESCAPE '\\'
        OR s.slug ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE(s.country, '') ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY s.updated_at DESC
    LIMIT 500
  `;

  return ok(c, rows.map((row: Record<string, any>) =>
    normalizeSupplierRow(row),
  ));
});

// ---------------------------------------------------------
// GET /suppliers/:id
// ---------------------------------------------------------

routes.get("/suppliers/:id", async (c) => {
  const id = checkId(c.req.param("id"));
  const sql = getSql(c.env);

  const rows = await sql`
    SELECT *
    FROM suppliers
    WHERE id = ${id}
    LIMIT 1
  `;

  if (!rows[0]) {
    return fail(
      c,
      404,
      "SUPPLIER_NOT_FOUND",
      "Supplier tidak ditemukan.",
    );
  }

  const samples = await sql`
    SELECT *
    FROM supplier_samples
    WHERE supplier_id = ${id}
    ORDER BY created_at DESC
    LIMIT 200
  `;

  return ok(c, {
    ...normalizeSupplierRow(rows[0] as Record<string, any>),
    samples: samples.map((row: Record<string, any>) =>
      normalizeSampleRow(row),
    ),
  });
});

// ---------------------------------------------------------
// POST /suppliers
// ---------------------------------------------------------

routes.post("/suppliers", async (c) => {
  const input = validateSupplierCreate(
    await readJsonObject(c),
  );

  if (isSupplierSlugBlocked(input.slug)) {
    return fail(
      c,
      422,
      "SUPPLIER_BLOCKED",
      "Supplier tidak diizinkan.",
    );
  }

  const sql = getSql(c.env);

  const values = CREATE_COLUMNS.map(
    (key) => input[key] ?? null,
  );

  const rows = await sql`
    INSERT INTO suppliers (
      slug,
      name,
      country,
      contact,
      channel,
      category,
      status,
      terms,
      note,
      last_activity_on
    )
    VALUES (
      ${values[0]},
      ${values[1]},
      ${values[2]},
      ${values[3]},
      ${values[4]},
      ${values[5]},
      ${values[6]},
      ${values[7]},
      ${values[8]},
      ${values[9]}
    )
    RETURNING *
  `;

  const row = rows[0] as Record<string, any>;

  await recordAudit(
    c,
    sql,
    "supplier.create",
    "supplier",
    String(row.id),
  );

  return created(c, normalizeSupplierRow(row));
});

// ---------------------------------------------------------
// PATCH /suppliers/:id
// ---------------------------------------------------------

routes.patch("/suppliers/:id", async (c) => {
  const id = checkId(c.req.param("id"));
  const input = validateSupplierUpdate(
    await readJsonObject(c),
  );

  if (input.slug && isSupplierSlugBlocked(input.slug)) {
    return fail(
      c,
      422,
      "SUPPLIER_BLOCKED",
      "Supplier tidak diizinkan.",
    );
  }

  const sql = getSql(c.env);

  const values = UPDATE_COLUMNS.map((key) =>
    Object.prototype.hasOwnProperty.call(input, key)
      ? input[key] ?? null
      : null,
  );

  const present = UPDATE_COLUMNS.map((key) =>
    Object.prototype.hasOwnProperty.call(input, key),
  );

  const rows = await sql`
    UPDATE suppliers SET
      slug = CASE WHEN ${present[0]} THEN ${values[0]} ELSE slug END,
      name = CASE WHEN ${present[1]} THEN ${values[1]} ELSE name END,
      country = CASE WHEN ${present[2]} THEN ${values[2]} ELSE country END,
      contact = CASE WHEN ${present[3]} THEN ${values[3]} ELSE contact END,
      channel = CASE WHEN ${present[4]} THEN ${values[4]} ELSE channel END,
      category = CASE WHEN ${present[5]} THEN ${values[5]} ELSE category END,
      status = CASE WHEN ${present[6]} THEN ${values[6]} ELSE status END,
      terms = CASE WHEN ${present[7]} THEN ${values[7]} ELSE terms END,
      note = CASE WHEN ${present[8]} THEN ${values[8]} ELSE note END,
      last_activity_on = CASE
        WHEN ${present[9]} THEN ${values[9]}::date
        ELSE last_activity_on
      END,
      updated_at = now()
    WHERE id = ${id}
      AND archived_at IS NULL
    RETURNING *
  `;

  if (!rows[0]) {
    return fail(
      c,
      404,
      "SUPPLIER_NOT_FOUND",
      "Supplier tidak ditemukan.",
    );
  }

  await recordAudit(
    c,
    sql,
    "supplier.update",
    "supplier",
    id,
  );

  return ok(c, normalizeSupplierRow(rows[0] as Record<string, any>));
});

// ---------------------------------------------------------
// POST /suppliers/:id/archive
// ---------------------------------------------------------

routes.post("/suppliers/:id/archive", async (c) => {
  const id = checkId(c.req.param("id"));
  const sql = getSql(c.env);

  const rows = await sql`
    UPDATE suppliers
    SET
      archived_at = COALESCE(archived_at, now()),
      updated_at = now()
    WHERE id = ${id}
      AND archived_at IS NULL
    RETURNING id, archived_at
  `;

  if (!rows[0]) {
    return fail(
      c,
      404,
      "SUPPLIER_NOT_FOUND",
      "Supplier aktif tidak ditemukan.",
    );
  }

  await recordAudit(
    c,
    sql,
    "supplier.archive",
    "supplier",
    id,
  );

  return ok(c, {
    id,
    archived: true,
    archived_at: iso(rows[0].archived_at),
  });
});

// ---------------------------------------------------------
// POST /suppliers/:id/samples
// ---------------------------------------------------------

routes.post("/suppliers/:id/samples", async (c) => {
  const supplierId = checkId(c.req.param("id"));

  const input = validateSampleCreate(
    await readJsonObject(c),
  );

  const sql = getSql(c.env);

  if (!(await supplierExists(sql, supplierId))) {
    return fail(
      c,
      404,
      "SUPPLIER_NOT_FOUND",
      "Supplier aktif tidak ditemukan.",
    );
  }

  const rows = await sql`
    INSERT INTO supplier_samples (
      supplier_id,
      description,
      state,
      awb,
      courier,
      eta,
      note
    )
    VALUES (
      ${supplierId},
      ${input.description},
      ${input.state},
      ${input.awb ?? null},
      ${input.courier ?? null},
      ${input.eta ?? null},
      ${input.note ?? null}
    )
    RETURNING *
  `;

  await sql`
    UPDATE suppliers
    SET updated_at = now(),
        last_activity_on = CURRENT_DATE
    WHERE id = ${supplierId}
  `;

  const row = rows[0] as Record<string, any>;

  await recordAudit(
    c,
    sql,
    "supplier.sample.create",
    "supplier_sample",
    String(row.id),
  );

  return created(c, normalizeSampleRow(row));
});

// ---------------------------------------------------------
// PATCH /samples/:id
// ---------------------------------------------------------

routes.patch("/samples/:id", async (c) => {
  const id = checkId(c.req.param("id"));

  const input = validateSampleUpdate(
    await readJsonObject(c),
  );

  const sql = getSql(c.env);

  const columns = [
    "description",
    "state",
    "awb",
    "courier",
    "eta",
    "note",
  ] as const;

  const values = columns.map((key) =>
    Object.prototype.hasOwnProperty.call(input, key)
      ? input[key] ?? null
      : null,
  );

  const present = columns.map((key) =>
    Object.prototype.hasOwnProperty.call(input, key),
  );

  const rows = await sql`
    UPDATE supplier_samples SET
      description = CASE
        WHEN ${present[0]} THEN ${values[0]}
        ELSE description
      END,
      state = CASE
        WHEN ${present[1]} THEN ${values[1]}
        ELSE state
      END,
      awb = CASE
        WHEN ${present[2]} THEN ${values[2]}
        ELSE awb
      END,
      courier = CASE
        WHEN ${present[3]} THEN ${values[3]}
        ELSE courier
      END,
      eta = CASE
        WHEN ${present[4]} THEN ${values[4]}::date
        ELSE eta
      END,
      note = CASE
        WHEN ${present[5]} THEN ${values[5]}
        ELSE note
      END,
      updated_at = now()
    WHERE id = ${id}
      AND EXISTS (
        SELECT 1
        FROM suppliers s
        WHERE s.id = supplier_samples.supplier_id
          AND s.archived_at IS NULL
      )
    RETURNING *
  `;

  if (!rows[0]) {
    return fail(
      c,
      404,
      "SAMPLE_NOT_FOUND",
      "Sampel tidak ditemukan.",
    );
  }

  const sample = rows[0] as Record<string, any>;

  await sql`
    UPDATE suppliers
    SET updated_at = now(),
        last_activity_on = CURRENT_DATE
    WHERE id = ${sample.supplier_id}
  `;

  await recordAudit(
    c,
    sql,
    "supplier.sample.update",
    "supplier_sample",
    id,
  );

  return ok(c, normalizeSampleRow(sample));
});

// ---------------------------------------------------------
// GET /summary
// ---------------------------------------------------------

routes.get("/summary", async (c) => {
  if (Object.keys(c.req.query()).length) {
    badRequest("Endpoint summary tidak menerima parameter.");
  }

  const sql = getSql(c.env);

  const [statusRows, categoryRows, sampleRows, activityRows] =
    await Promise.all([
      sql`
        SELECT status, COUNT(*)::int AS total
        FROM suppliers
        WHERE archived_at IS NULL
          AND LOWER(slug) NOT LIKE 'liyin%'
          AND name NOT ILIKE '%liyin biotech%'
          AND name NOT ILIKE '%yolanda yue%'
        GROUP BY status
        ORDER BY status
      `,

      sql`
        SELECT category, COUNT(*)::int AS total
        FROM suppliers
        WHERE archived_at IS NULL
          AND LOWER(slug) NOT LIKE 'liyin%'
          AND name NOT ILIKE '%liyin biotech%'
          AND name NOT ILIKE '%yolanda yue%'
        GROUP BY category
        ORDER BY category
      `,

      sql`
        SELECT ss.state, COUNT(*)::int AS total
        FROM supplier_samples ss
        JOIN suppliers s ON s.id = ss.supplier_id
        WHERE s.archived_at IS NULL
          AND LOWER(s.slug) NOT LIKE 'liyin%'
            AND s.name NOT ILIKE '%liyin biotech%'
            AND s.name NOT ILIKE '%yolanda yue%'
        GROUP BY ss.state
        ORDER BY ss.state
      `,

      sql`
        SELECT *
        FROM (
          SELECT
            s.id,
            'supplier'::text AS resource_type,
            s.name AS title,
            s.status AS state,
            s.updated_at AS occurred_at
          FROM suppliers s
          WHERE s.archived_at IS NULL
            AND LOWER(s.slug) NOT LIKE 'liyin%'
            AND s.name NOT ILIKE '%liyin biotech%'
            AND s.name NOT ILIKE '%yolanda yue%'

          UNION ALL

          SELECT
            ss.id,
            'sample'::text AS resource_type,
            ss.description AS title,
            ss.state AS state,
            ss.updated_at AS occurred_at
          FROM supplier_samples ss
          JOIN suppliers s ON s.id = ss.supplier_id
          WHERE s.archived_at IS NULL
            AND LOWER(s.slug) NOT LIKE 'liyin%'
            AND s.name NOT ILIKE '%liyin biotech%'
            AND s.name NOT ILIKE '%yolanda yue%'
        ) activity
        ORDER BY occurred_at DESC
        LIMIT 10
      `,
    ]);

  return ok(c, {
    suppliers_by_status: statusRows,
    suppliers_by_category: categoryRows,
    samples_by_state: sampleRows,
    recent_activity: activityRows.map(
      (row: Record<string, any>) => ({
        ...row,
        occurred_at: iso(row.occurred_at),
      }),
    ),
  });
});

// ---------------------------------------------------------
// POST /import
// Bearer API_TOKEN only (actor owner)
// ---------------------------------------------------------

routes.post("/import", async (c) => {
  if (c.get("actor") !== "owner") {
    return fail(
      c,
      403,
      "ADMIN_ONLY",
      "Import hanya tersedia untuk admin.",
    );
  }

  const body = await readJsonObject(c);
  const envelope = parseSchema(importSchema, body);

  // Blokir Liyin sebelum ada operasi database.
  for (const item of envelope.items) {
    if (
      item !== null
      && typeof item === "object"
      && !Array.isArray(item)
    ) {
      const slug = (item as Record<string, unknown>).slug;

      if (
        typeof slug === "string"
        && isSupplierSlugBlocked(slug)
      ) {
        return fail(
          c,
          422,
          "SUPPLIER_BLOCKED",
          "Import mengandung supplier yang tidak diizinkan.",
        );
      }
    }
  }

  const sql = getSql(c.env);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of envelope.items) {
    const parsed = supplierCreateSchema.safeParse(item);

    if (!parsed.success) {
      skippedCount += 1;
      continue;
    }

    try {
      const input = parsed.data;

      if (isSupplierSlugBlocked(input.slug)) {
        return fail(
          c,
          422,
          "SUPPLIER_BLOCKED",
          "Supplier tidak diizinkan.",
        );
      }

      // Proteksi data non-bisnis.
      const { assertSafeSupplier } = await import("./supplierModel");

      assertSafeSupplier(input as Record<string, unknown>);

      const values = CREATE_COLUMNS.map(
        (key) => input[key] ?? null,
      );

      const rows = await sql`
        INSERT INTO suppliers (
          slug,
          name,
          country,
          contact,
          channel,
          category,
          status,
          terms,
          note,
          last_activity_on
        )
        VALUES (
          ${values[0]},
          ${values[1]},
          ${values[2]},
          ${values[3]},
          ${values[4]},
          ${values[5]},
          ${values[6]},
          ${values[7]},
          ${values[8]},
          ${values[9]}
        )
        ON CONFLICT (slug)
        DO UPDATE SET
          name = EXCLUDED.name,
          country = EXCLUDED.country,
          contact = EXCLUDED.contact,
          channel = EXCLUDED.channel,
          category = EXCLUDED.category,
          status = EXCLUDED.status,
          terms = EXCLUDED.terms,
          note = EXCLUDED.note,
          last_activity_on = EXCLUDED.last_activity_on,
          updated_at = now()
        RETURNING id, (xmax = 0) AS inserted
      `;

      if (rows[0]?.inserted === true) {
        createdCount += 1;
      } else if (rows[0]) {
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        skippedCount += 1;
        continue;
      }

      // Jangan membocorkan detail database.
      throw error;
    }
  }

  await recordAudit(
    c,
    sql,
    "supplier.import",
    "supplier",
    "batch",
  );

  return ok(c, {
    created: createdCount,
    updated: updatedCount,
    skipped: skippedCount,
  });
});

export { routes as supplierRoutes };
