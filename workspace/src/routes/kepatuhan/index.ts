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

const kepatuhanRoutes = new Hono<AppEnv>();

// ============================================================
// CONSTANTS
// ============================================================

const SUBJECT_TYPES = [
  "supplier",
  "produk",
  "klinik",
] as const;

const STATUSES = [
  "belum",
  "diminta",
  "diterima",
  "diverifikasi",
  "ditolak",
  "kedaluwarsa",
] as const;

const DOC_TYPES = [
  "coa_same_batch",
  "msds_sds",
  "inci",
  "iso_22716_gmpc",
  "halal",
  "loa_bpom",
  "cfs",
  "tropical_stability_40c_75rh_3m",
  "hs_code",
] as const;

const ALLOWED_QUERY = new Set([
  "subject_type",
  "status",
  "q",
  "overdue",
  "limit",
  "page",
]);

const CREATE_FIELDS = [
  "subject_type",
  "subject_ref",
  "doc_type",
  "status",
  "due_on",
  "received_on",
  "expires_on",
  "file_url",
  "note",
] as const;

const UPDATE_FIELDS = CREATE_FIELDS;

type SubjectType = typeof SUBJECT_TYPES[number];
type ComplianceStatus = typeof STATUSES[number];
type DocType = typeof DOC_TYPES[number];

type ComplianceInput = {
  subject_type: SubjectType;
  subject_ref: string;
  doc_type: DocType;
  status: ComplianceStatus;
  due_on: string | null;
  received_on: string | null;
  expires_on: string | null;
  file_url: string | null;
  note: string | null;
};

// ============================================================
// OUTPUT HELPERS
// ============================================================

const DATE_COLUMNS = ["due_on", "received_on", "expires_on"] as const;

function dateOut(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function itemOut(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const key of DATE_COLUMNS) out[key] = dateOut(row[key]);
  return out;
}

function isDuplicate(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
}

const DUPLICATE_MESSAGE = "Dokumen ini sudah ada untuk subjek yang sama.";

// ============================================================
// VALIDATION HELPERS
// ============================================================

function badRequest(
  message: string,
  fields?: Record<string, string>,
): never {
  throw new ValidationError(
    "BAD_REQUEST",
    message,
    fields ? { fields } : undefined,
  );
}

function validationError(
  fields: Record<string, string>,
): never {
  throw new ValidationError(
    "VALIDATION_ERROR",
    "Data kepatuhan tidak valid.",
    { fields },
  );
}

function rejectUnknown(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const permitted = new Set(allowed);

  const unknown = Object.keys(input).filter(
    (key) => !permitted.has(key),
  );

  if (unknown.length > 0) {
    badRequest(
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

function checkId(value: string): string {
  if (!isUuid(value)) {
    badRequest("ID kepatuhan tidak valid.", {
      id: "UUID tidak valid.",
    });
  }

  return value;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
  );
}

function optionalDate(
  input: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
): string | null {
  const value = input[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || !isDate(value)) {
    fields[key] = "Gunakan tanggal YYYY-MM-DD yang valid.";
    return null;
  }

  return value;
}

function optionalText(
  input: Record<string, unknown>,
  key: string,
  max: number,
  fields: Record<string, string>,
): string | null {
  const value = input[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    fields[key] = "Harus berupa teks.";
    return null;
  }

  const normalized = value.trim();

  if (normalized.length > max) {
    fields[key] = `Maksimal ${max} karakter.`;
    return null;
  }

  return normalized || null;
}

function validateSubjectType(
  value: unknown,
  fields: Record<string, string>,
): SubjectType {
  if (
    typeof value !== "string"
    || !SUBJECT_TYPES.includes(value as SubjectType)
  ) {
    fields.subject_type = "Jenis subjek tidak valid.";
    return "supplier";
  }

  return value as SubjectType;
}

function validateDocType(
  value: unknown,
  fields: Record<string, string>,
): DocType {
  if (
    typeof value !== "string"
    || !DOC_TYPES.includes(value as DocType)
  ) {
    fields.doc_type = "Jenis dokumen tidak valid.";
    return "coa_same_batch";
  }

  return value as DocType;
}

function validateStatus(
  value: unknown,
  fields: Record<string, string>,
): ComplianceStatus {
  if (
    typeof value !== "string"
    || !STATUSES.includes(value as ComplianceStatus)
  ) {
    fields.status = "Status dokumen tidak valid.";
    return "belum";
  }

  return value as ComplianceStatus;
}

function validateFileUrl(
  value: unknown,
  fields: Record<string, string>,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    fields.file_url = "URL harus berupa teks.";
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
    ) {
      fields.file_url = "File harus menggunakan URL HTTPS.";
      return null;
    }

    return url.toString();
  } catch {
    fields.file_url = "URL tidak valid.";
    return null;
  }
}

function validateCompliance(
  input: Record<string, unknown>,
): ComplianceInput {
  rejectUnknown(input, CREATE_FIELDS);

  const fields: Record<string, string> = {};

  const subject_type = validateSubjectType(
    input.subject_type,
    fields,
  );

  const doc_type = validateDocType(
    input.doc_type,
    fields,
  );

  const status = input.status === undefined
    ? "belum"
    : validateStatus(input.status, fields);

  const subject_ref = typeof input.subject_ref === "string"
    ? input.subject_ref.trim()
    : "";

  if (!subject_ref || subject_ref.length > 200) {
    fields.subject_ref =
      "Nama atau referensi subjek wajib diisi, maksimal 200 karakter.";
  }

  const due_on = optionalDate(input, "due_on", fields);

  const received_on = optionalDate(
    input,
    "received_on",
    fields,
  );

  const expires_on = optionalDate(
    input,
    "expires_on",
    fields,
  );

  const file_url = validateFileUrl(
    input.file_url,
    fields,
  );

  const note = optionalText(
    input,
    "note",
    4000,
    fields,
  );

  if (status === "diverifikasi" && !received_on) {
    fields.received_on =
      "Tanggal penerimaan wajib untuk dokumen terverifikasi.";
  }

  if (
    received_on
    && expires_on
    && expires_on < received_on
  ) {
    fields.expires_on =
      "Tanggal kedaluwarsa tidak boleh sebelum tanggal penerimaan.";
  }

  if (Object.keys(fields).length > 0) {
    validationError(fields);
  }

  return {
    subject_type,
    subject_ref,
    doc_type,
    status,
    due_on,
    received_on,
    expires_on,
    file_url,
    note,
  };
}

// ============================================================
// PATCH VALIDATION
// ============================================================

function validatePatch(
  input: Record<string, unknown>,
): Partial<ComplianceInput> {
  rejectUnknown(input, UPDATE_FIELDS);

  if (Object.keys(input).length === 0) {
    badRequest("Minimal satu field harus diperbarui.");
  }

  const fields: Record<string, string> = {};
  const result: Partial<ComplianceInput> = {};

  if ("subject_type" in input) {
    result.subject_type = validateSubjectType(
      input.subject_type,
      fields,
    );
  }

  if ("subject_ref" in input) {
    const value = input.subject_ref;

    if (
      typeof value !== "string"
      || !value.trim()
      || value.trim().length > 200
    ) {
      fields.subject_ref = "Referensi subjek tidak valid.";
    } else {
      result.subject_ref = value.trim();
    }
  }

  if ("doc_type" in input) {
    result.doc_type = validateDocType(
      input.doc_type,
      fields,
    );
  }

  if ("status" in input) {
    result.status = validateStatus(
      input.status,
      fields,
    );
  }

  for (const key of [
    "due_on",
    "received_on",
    "expires_on",
  ] as const) {
    if (key in input) {
      result[key] = optionalDate(input, key, fields);
    }
  }

  if ("file_url" in input) {
    result.file_url = validateFileUrl(
      input.file_url,
      fields,
    );
  }

  if ("note" in input) {
    result.note = optionalText(
      input,
      "note",
      4000,
      fields,
    );
  }

  if (Object.keys(fields).length > 0) {
    validationError(fields);
  }

  return result;
}

// ============================================================
// QUERY HELPERS
// ============================================================

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parsePagination(query: Record<string, string>) {
  const limitRaw = query.limit ?? "50";
  const pageRaw = query.page ?? "1";

  if (
    !/^\d+$/.test(limitRaw)
    || !/^\d+$/.test(pageRaw)
  ) {
    badRequest("Parameter pagination harus berupa angka.");
  }

  const limit = clampInt(limitRaw, 1, 200, 50);
  const page = clampInt(pageRaw, 1, 1000000, 1);

  return {
    limit,
    page,
    offset: (page - 1) * limit,
  };
}

function validateQuery(
  query: Record<string, string>,
): void {
  const unknown = Object.keys(query).filter(
    (key) => !ALLOWED_QUERY.has(key),
  );

  if (unknown.length > 0) {
    badRequest(
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
    query.subject_type
    && !SUBJECT_TYPES.includes(
      query.subject_type as SubjectType,
    )
  ) {
    badRequest("Filter subject_type tidak valid.");
  }

  if (
    query.status
    && !STATUSES.includes(
      query.status as ComplianceStatus,
    )
  ) {
    badRequest("Filter status tidak valid.");
  }

  if (
    query.overdue !== undefined
    && query.overdue !== "true"
    && query.overdue !== "false"
  ) {
    badRequest("overdue harus true atau false.");
  }

  if (
    query.q !== undefined
    && query.q.length > 200
  ) {
    badRequest("Parameter q maksimal 200 karakter.");
  }
}

// ============================================================
// GET /items
// ============================================================

kepatuhanRoutes.get("/items", async (c) => {
  const query = c.req.query();

  validateQuery(query);

  const { limit, page, offset } = parsePagination(query);

  const subjectType = query.subject_type ?? null;
  const status = query.status ?? null;

  const q = query.q?.trim() || null;

  const pattern = q
    ? `%${escapeLike(q)}%`
    : null;

  const overdue = query.overdue === "true";

  const sql = getSql(c.env);

  const rows = await sql`
    SELECT
      ci.*,
      (ci.expires_on < CURRENT_DATE) AS is_expired,
      (
        ci.due_on < CURRENT_DATE
        AND ci.status NOT IN (
          'diverifikasi',
          'ditolak',
          'kedaluwarsa'
        )
      ) AS is_overdue,
      COUNT(*) OVER()::int AS total_count
    FROM compliance_items ci
    WHERE
      (
        ${subjectType}::text IS NULL
        OR ci.subject_type = ${subjectType}
      )
      AND (
        ${status}::text IS NULL
        OR ci.status = ${status}
      )
      AND (
        ${pattern}::text IS NULL
        OR ci.subject_ref ILIKE ${pattern} ESCAPE '\\'
        OR ci.doc_type ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE(ci.note, '') ILIKE ${pattern} ESCAPE '\\'
      )
      AND (
        ${overdue}::boolean = false
        OR (
          ci.due_on < CURRENT_DATE
          AND ci.status NOT IN (
            'diverifikasi',
            'ditolak',
            'kedaluwarsa'
          )
        )
      )
    ORDER BY ci.updated_at DESC, ci.id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const total = rows.length > 0
    ? Number(rows[0].total_count)
    : 0;

  const data = rows.map((row: Record<string, unknown>) => {
    const {
      total_count,
      ...item
    } = row;

    return itemOut(item);
  });

  return ok(c, data, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

// ============================================================
// POST /items
// ============================================================

kepatuhanRoutes.post("/items", async (c) => {
  const body = await readJsonObject(c);

  const input = validateCompliance(body);

  const sql = getSql(c.env);

  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
    INSERT INTO compliance_items (
      subject_type,
      subject_ref,
      doc_type,
      status,
      due_on,
      received_on,
      expires_on,
      file_url,
      note
    )
    VALUES (
      ${input.subject_type},
      ${input.subject_ref},
      ${input.doc_type},
      ${input.status},
      ${input.due_on},
      ${input.received_on},
      ${input.expires_on},
      ${input.file_url},
      ${input.note}
    )
    RETURNING *
  `;
  } catch (error) {
    if (isDuplicate(error)) return fail(c, 409, "COMPLIANCE_DUPLICATE", DUPLICATE_MESSAGE);
    throw error;
  }

  const row = itemOut(rows[0] as Record<string, unknown>);

  await audit(sql, {
    actor: c.get("actor"),
    action: "kepatuhan.item.create",
    resourceType: "compliance_item",
    resourceId: String(row.id),
    requestId: c.get("requestId"),
    ok: true,
  });

  return created(c, row);
});

// ============================================================
// PATCH /items/:id
// ============================================================

kepatuhanRoutes.patch("/items/:id", async (c) => {
  const id = checkId(c.req.param("id"));

  const body = await readJsonObject(c);

  const patch = validatePatch(body);

  const sql = getSql(c.env);

  const existingRows = await sql`
    SELECT *
    FROM compliance_items
    WHERE id = ${id}
    LIMIT 1
  `;

  if (!existingRows[0]) {
    return fail(
      c,
      404,
      "COMPLIANCE_ITEM_NOT_FOUND",
      "Dokumen kepatuhan tidak ditemukan.",
    );
  }

  const existing = itemOut(existingRows[0] as Record<string, unknown>) as Record<string, any>;

  const merged = {
    subject_type: patch.subject_type ?? existing.subject_type,
    subject_ref: patch.subject_ref ?? existing.subject_ref,
    doc_type: patch.doc_type ?? existing.doc_type,
    status: patch.status ?? existing.status,
    due_on: Object.hasOwn(patch, "due_on")
      ? patch.due_on
      : existing.due_on,
    received_on: Object.hasOwn(patch, "received_on")
      ? patch.received_on
      : existing.received_on,
    expires_on: Object.hasOwn(patch, "expires_on")
      ? patch.expires_on
      : existing.expires_on,
    file_url: Object.hasOwn(patch, "file_url")
      ? patch.file_url
      : existing.file_url,
    note: Object.hasOwn(patch, "note")
      ? patch.note
      : existing.note,
  };

  const fields: Record<string, string> = {};

  if (
    merged.status === "diverifikasi"
    && !merged.received_on
  ) {
    fields.received_on =
      "Tanggal penerimaan wajib untuk dokumen terverifikasi.";
  }

  if (
    merged.received_on
    && merged.expires_on
    && String(merged.expires_on) < String(merged.received_on)
  ) {
    fields.expires_on =
      "Tanggal kedaluwarsa tidak boleh sebelum tanggal penerimaan.";
  }

  if (Object.keys(fields).length > 0) {
    validationError(fields);
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
    UPDATE compliance_items
    SET
      subject_type = ${merged.subject_type},
      subject_ref = ${merged.subject_ref},
      doc_type = ${merged.doc_type},
      status = ${merged.status},
      due_on = ${merged.due_on},
      received_on = ${merged.received_on},
      expires_on = ${merged.expires_on},
      file_url = ${merged.file_url},
      note = ${merged.note},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  } catch (error) {
    if (isDuplicate(error)) return fail(c, 409, "COMPLIANCE_DUPLICATE", DUPLICATE_MESSAGE);
    throw error;
  }

  if (!rows[0]) {
    return fail(
      c,
      404,
      "COMPLIANCE_ITEM_NOT_FOUND",
      "Dokumen kepatuhan tidak ditemukan.",
    );
  }

  await audit(sql, {
    actor: c.get("actor"),
    action: "kepatuhan.item.update",
    resourceType: "compliance_item",
    resourceId: id,
    requestId: c.get("requestId"),
    ok: true,
  });

  return ok(c, itemOut(rows[0]));
});

// ============================================================
// GET /summary
// ============================================================

kepatuhanRoutes.get("/summary", async (c) => {
  if (Object.keys(c.req.query()).length > 0) {
    badRequest("Endpoint summary tidak menerima parameter.");
  }

  const sql = getSql(c.env);

  const [statusRows, overdueRows, expiringRows, expiredRows] =
    await Promise.all([
      sql`
        SELECT
          status,
          COUNT(*)::int AS total
        FROM compliance_items
        GROUP BY status
        ORDER BY status
      `,

      sql`
        SELECT COUNT(*)::int AS total
        FROM compliance_items
        WHERE
          due_on < CURRENT_DATE
          AND status NOT IN (
            'diverifikasi',
            'ditolak',
            'kedaluwarsa'
          )
      `,

      sql`
        SELECT COUNT(*)::int AS total
        FROM compliance_items
        WHERE
          expires_on >= CURRENT_DATE
          AND expires_on <= CURRENT_DATE + 30
      `,

      sql`
        SELECT COUNT(*)::int AS total
        FROM compliance_items
        WHERE expires_on < CURRENT_DATE
      `,
    ]);

  const byStatus: Record<string, number> = {
    belum: 0,
    diminta: 0,
    diterima: 0,
    diverifikasi: 0,
    ditolak: 0,
    kedaluwarsa: 0,
  };

  for (const row of statusRows) {
    byStatus[String(row.status)] = Number(row.total);
  }

  return ok(c, {
    by_status: byStatus,
    total: Object.values(byStatus).reduce(
      (sum, value) => sum + value,
      0,
    ),
    overdue: Number(overdueRows[0]?.total ?? 0),
    expiring_30_days: Number(
      expiringRows[0]?.total ?? 0,
    ),
    expired: Number(expiredRows[0]?.total ?? 0),
  });
});

// ============================================================
// POST /items/bulk-template
// ============================================================

kepatuhanRoutes.post(
  "/items/bulk-template",
  async (c) => {
    const body = await readJsonObject(c);

    rejectUnknown(body, [
      "subject_type",
      "subject_ref",
    ]);

    const fields: Record<string, string> = {};

    const subject_type = validateSubjectType(
      body.subject_type,
      fields,
    );

    const subject_ref = typeof body.subject_ref === "string"
      ? body.subject_ref.trim()
      : "";

    if (!subject_ref || subject_ref.length > 200) {
      fields.subject_ref =
        "Referensi subjek wajib diisi, maksimal 200 karakter.";
    }

    if (Object.keys(fields).length > 0) {
      validationError(fields);
    }

    const sql = getSql(c.env);

    let createdCount = 0;

    for (const docType of DOC_TYPES) {
      const rows = await sql`
        INSERT INTO compliance_items (
          subject_type,
          subject_ref,
          doc_type,
          status
        )
        VALUES (
          ${subject_type},
          ${subject_ref},
          ${docType},
          'belum'
        )
        ON CONFLICT (
          subject_type,
          subject_ref,
          doc_type
        )
        DO NOTHING
        RETURNING id
      `;

      if (rows.length > 0) {
        createdCount += 1;
      }
    }

    if (createdCount > 0) {
      await audit(sql, {
        actor: c.get("actor"),
        action: "kepatuhan.items.bulk_template",
        resourceType: "compliance_item",
        resourceId: `${subject_type}:${subject_ref}`,
        requestId: c.get("requestId"),
        ok: true,
      });
    }

    return ok(c, {
      subject_type,
      subject_ref,
      created: createdCount,
      skipped: DOC_TYPES.length - createdCount,
      total: DOC_TYPES.length,
    });
  },
);

export { kepatuhanRoutes };
