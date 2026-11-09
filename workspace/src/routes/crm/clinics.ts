import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError } from "../../lib/http";
import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";
import { readJsonObject } from "../../lib/body";
import { isUuid, clampInt, isEmail, normalizePhoneId } from "../../lib/validate";
import { rowToClinic, STAGES, validateClinicInput } from "./clinicModel";

const crmRoutes = new Hono<AppEnv>();
const SORT_KEYS = new Set(["name", "created_at", "last_contact_at", "next_followup_at", "interest", "stage"]);
const UPDATE_COLUMNS = [
  "name", "city", "province", "address", "interest", "pic_name", "pic_role",
  "phone", "email", "doctors_count", "services", "hours", "notes",
] as const;

function csv(value: string | undefined): string[] | null {
  if (!value) return null;
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? [...new Set(values)] : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function badRequest(message = "Parameter tidak valid.") {
  throw new ValidationError("BAD_REQUEST", message);
}

async function fetchClinicDetail(sql: ReturnType<typeof getSql>, id: string) {
  const rows = await sql`SELECT * FROM clinics WHERE id = ${id} LIMIT 1`;
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) return null;

  const [tagRows, contacts, activities, followups] = await Promise.all([
    sql`SELECT name FROM clinic_tags WHERE clinic_id = ${id} ORDER BY name ASC`,
    sql`SELECT id, clinic_id, name, role, phone, email, preferred_channel, is_primary, created_at
      FROM clinic_contacts WHERE clinic_id = ${id}
      ORDER BY is_primary DESC, created_at ASC`,
    sql`SELECT id, clinic_id, type, summary, detail, occurred_at, created_at
      FROM clinic_activities WHERE clinic_id = ${id}
      ORDER BY occurred_at DESC LIMIT 200`,
    sql`SELECT id, clinic_id, scheduled_at, reason, completed, completed_at, created_at
      FROM clinic_followups WHERE clinic_id = ${id}
      ORDER BY scheduled_at ASC`,
  ]);

  const contactData = contacts.map((item: Record<string, any>) => ({ ...item, created_at: iso(item.created_at) }));
  const activityData = activities.map((item: Record<string, any>) => ({
    ...item, occurred_at: iso(item.occurred_at), created_at: iso(item.created_at),
  }));
  const followupData = followups.map((item: Record<string, any>) => ({
    ...item, scheduled_at: iso(item.scheduled_at), completed_at: iso(item.completed_at), created_at: iso(item.created_at),
  }));
  return {
    ...rowToClinic(row, tagRows.map((item: Record<string, unknown>) => String(item.name)), contactData, activityData),
    followups: followupData,
  };
}

crmRoutes.get("/clinics", async (c) => {
  const sql = getSql(c.env);
  const query = c.req.query();
  const search = query.search?.trim() || null;
  const stages = csv(query.stage);
  const provinces = csv(query.province);
  const tag = query.tag?.trim().toLowerCase() || null;
  const sort = SORT_KEYS.has(query.sort ?? "") ? query.sort! : "created_at";
  const order = query.order === "asc" ? "asc" : "desc";
  const page = clampInt(query.page, 1, 1000000, 1);
  const limit = clampInt(query.limit, 1, 100, 20);
  const offset = (page - 1) * limit;

  let interest: number | null = null;
  if (query.interest !== undefined && query.interest !== "") {
    if (!/^[123]$/.test(query.interest)) badRequest("Filter interest tidak valid.");
    interest = Number(query.interest);
  }
  let archived = false;
  if (query.archived !== undefined) {
    if (query.archived !== "true" && query.archived !== "false") badRequest("Filter archived tidak valid.");
    archived = query.archived === "true";
  }

  const searchPattern = search ? `%${escapeLike(search)}%` : null;
  const [rows, countRows, stageRows, provinceRows] = await Promise.all([
    sql`SELECT c.* FROM clinics c
      WHERE c.archived = ${archived}
        AND (${stages}::text[] IS NULL OR c.stage = ANY(${stages}::text[]))
        AND (${provinces}::text[] IS NULL OR c.province = ANY(${provinces}::text[]))
        AND (${interest}::smallint IS NULL OR c.interest = ${interest})
        AND (${searchPattern}::text IS NULL OR
          c.name ILIKE ${searchPattern} ESCAPE '\\' OR
          c.city ILIKE ${searchPattern} ESCAPE '\\' OR
          COALESCE(c.pic_name, '') ILIKE ${searchPattern} ESCAPE '\\')
        AND (${tag}::text IS NULL OR EXISTS (
          SELECT 1 FROM clinic_tags t WHERE t.clinic_id = c.id AND t.name = ${tag}
        ))
      ORDER BY
        CASE WHEN ${sort} = 'name' AND ${order} = 'asc' THEN c.name END ASC,
        CASE WHEN ${sort} = 'name' AND ${order} = 'desc' THEN c.name END DESC,
        CASE WHEN ${sort} = 'created_at' AND ${order} = 'asc' THEN c.created_at END ASC,
        CASE WHEN ${sort} = 'created_at' AND ${order} = 'desc' THEN c.created_at END DESC,
        CASE WHEN ${sort} = 'last_contact_at' AND ${order} = 'asc' THEN c.last_contact_at END ASC,
        CASE WHEN ${sort} = 'last_contact_at' AND ${order} = 'desc' THEN c.last_contact_at END DESC,
        CASE WHEN ${sort} = 'next_followup_at' AND ${order} = 'asc' THEN c.next_followup_at END ASC,
        CASE WHEN ${sort} = 'next_followup_at' AND ${order} = 'desc' THEN c.next_followup_at END DESC,
        CASE WHEN ${sort} = 'interest' AND ${order} = 'asc' THEN c.interest END ASC,
        CASE WHEN ${sort} = 'interest' AND ${order} = 'desc' THEN c.interest END DESC,
        CASE WHEN ${sort} = 'stage' AND ${order} = 'asc' THEN c.stage END ASC,
        CASE WHEN ${sort} = 'stage' AND ${order} = 'desc' THEN c.stage END DESC,
        c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    sql`SELECT count(*)::int AS total FROM clinics c
      WHERE c.archived = ${archived}
        AND (${stages}::text[] IS NULL OR c.stage = ANY(${stages}::text[]))
        AND (${provinces}::text[] IS NULL OR c.province = ANY(${provinces}::text[]))
        AND (${interest}::smallint IS NULL OR c.interest = ${interest})
        AND (${searchPattern}::text IS NULL OR
          c.name ILIKE ${searchPattern} ESCAPE '\\' OR
          c.city ILIKE ${searchPattern} ESCAPE '\\' OR
          COALESCE(c.pic_name, '') ILIKE ${searchPattern} ESCAPE '\\')
        AND (${tag}::text IS NULL OR EXISTS (
          SELECT 1 FROM clinic_tags t WHERE t.clinic_id = c.id AND t.name = ${tag}
        ))`,
    sql`SELECT stage, count(*)::int AS count FROM clinics WHERE archived = false GROUP BY stage`,
    sql`SELECT province, count(*)::int AS count FROM clinics WHERE archived = false GROUP BY province ORDER BY province ASC`,
  ]);

  const ids = rows.map((row: Record<string, unknown>) => row.id as string);
  const tagRows = ids.length
    ? await sql`SELECT clinic_id, name FROM clinic_tags WHERE clinic_id = ANY(${ids}::uuid[]) ORDER BY name ASC`
    : [];
  const tagsByClinic = new Map<string, string[]>();
  for (const row of tagRows) {
    const key = String(row.clinic_id);
    const values = tagsByClinic.get(key) ?? [];
    values.push(String(row.name));
    tagsByClinic.set(key, values);
  }

  const byStage: Record<string, number> = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
  for (const row of stageRows) byStage[String(row.stage)] = Number(row.count);
  const byProvince: Record<string, number> = {};
  for (const row of provinceRows) byProvince[String(row.province)] = Number(row.count);
  const total = Number(countRows[0]?.total ?? 0);
  const data = rows.map((row: Record<string, any>) => rowToClinic(row, tagsByClinic.get(String(row.id)) ?? [], [], []));

  return c.json({
    data,
    meta: {
      page, limit, total, total_pages: Math.ceil(total / limit),
      counts: {
        total: stageRows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.count), 0),
        by_stage: byStage,
        by_province: byProvince,
      },
    },
  });
});

crmRoutes.get("/clinics/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) badRequest("ID klinik tidak valid.");
  const data = await fetchClinicDetail(getSql(c.env), id);
  if (!data) {
    return c.json({ error: { code: "CLINIC_NOT_FOUND", message: "Klinik tidak ditemukan.", request_id: c.get("requestId") } }, 404);
  }
  return c.json({ data }, 200);
});

crmRoutes.post("/clinics", async (c) => {
  const body = await readJsonObject(c);
  const input = validateClinicInput(body, "create");
  const sql = getSql(c.env);
  const tags = input.tags ?? [];
  const rows = await sql`WITH inserted AS (
      INSERT INTO clinics
        (name, city, province, address, stage, interest, pic_name, pic_role, phone, email,
         doctors_count, services, hours, notes)
      VALUES
        (${input.name}, ${input.city}, ${input.province}, ${input.address ?? null},
         ${input.stage ?? "lead"}, ${input.interest ?? null}, ${input.pic_name ?? null},
         ${input.pic_role ?? null}, ${input.phone ?? null}, ${input.email ?? null},
         ${input.doctors_count ?? 0}, ${input.services ?? []}::text[],
         ${input.hours ?? null}, ${input.notes ?? null})
      RETURNING *
    ), inserted_tags AS (
      INSERT INTO clinic_tags (clinic_id, name)
      SELECT inserted.id, t.name FROM inserted CROSS JOIN unnest(${tags}::text[]) AS t(name)
      ON CONFLICT DO NOTHING
    )
    SELECT * FROM inserted`;
  const inserted = rows[0] as Record<string, any> | undefined;
  if (!inserted) throw new Error("Clinic insert returned no row");
  const data = await fetchClinicDetail(sql, String(inserted.id));
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.create", resourceType: "clinic",
    resourceId: String(inserted.id), requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data, message: "Data berhasil dibuat." }, 201);
});

crmRoutes.patch("/clinics/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) badRequest("ID klinik tidak valid.");
  const body = await readJsonObject(c);
  if (Object.keys(body).length === 0) badRequest("Body tidak boleh kosong.");
  const input = validateClinicInput(body, "update");
  const sql = getSql(c.env);
  const values = UPDATE_COLUMNS.map((key) => input[key]);
  const present = UPDATE_COLUMNS.map((key) => Object.prototype.hasOwnProperty.call(input, key));
  const updateQuery = sql`UPDATE clinics SET
      name = CASE WHEN ${present[0]} THEN ${values[0]} ELSE name END,
      city = CASE WHEN ${present[1]} THEN ${values[1]} ELSE city END,
      province = CASE WHEN ${present[2]} THEN ${values[2]} ELSE province END,
      address = CASE WHEN ${present[3]} THEN ${values[3]} ELSE address END,
      interest = CASE WHEN ${present[4]} THEN ${values[4]} ELSE interest END,
      pic_name = CASE WHEN ${present[5]} THEN ${values[5]} ELSE pic_name END,
      pic_role = CASE WHEN ${present[6]} THEN ${values[6]} ELSE pic_role END,
      phone = CASE WHEN ${present[7]} THEN ${values[7]} ELSE phone END,
      email = CASE WHEN ${present[8]} THEN ${values[8]} ELSE email END,
      doctors_count = CASE WHEN ${present[9]} THEN ${values[9]} ELSE doctors_count END,
      services = CASE WHEN ${present[10]} THEN ${values[10]}::text[] ELSE services END,
      hours = CASE WHEN ${present[11]} THEN ${values[11]} ELSE hours END,
      notes = CASE WHEN ${present[12]} THEN ${values[12]} ELSE notes END,
      updated_at = now()
    WHERE id = ${id} AND archived = false
    RETURNING *`;

  const tagsWereSent = Object.prototype.hasOwnProperty.call(input, "tags");
  const statements = tagsWereSent
    ? [
        updateQuery,
        sql`DELETE FROM clinic_tags
          WHERE clinic_id = ${id} AND NOT (name = ANY(${input.tags ?? []}::text[]))`,
        sql`INSERT INTO clinic_tags (clinic_id, name)
          SELECT ${id}, t.name FROM unnest(${input.tags ?? []}::text[]) AS t(name)
          ON CONFLICT (clinic_id, name) DO NOTHING`,
      ]
    : [updateQuery];
  const transactionResult = await (sql as any).transaction(statements);
  const updatedRows = transactionResult[0] as Record<string, any>[];
  if (!updatedRows?.[0]) {
    const existing = await sql`SELECT archived FROM clinics WHERE id = ${id} LIMIT 1`;
    if (!existing[0]) {
      return c.json({ error: { code: "CLINIC_NOT_FOUND", message: "Klinik tidak ditemukan.", request_id: c.get("requestId") } }, 404);
    }
    if (existing[0].archived) {
      return c.json({ error: { code: "ARCHIVED_CLINIC", message: "Klinik arsip tidak dapat diperbarui.", request_id: c.get("requestId") } }, 409);
    }
    return c.json({ error: { code: "CLINIC_NOT_FOUND", message: "Klinik tidak ditemukan.", request_id: c.get("requestId") } }, 404);
  }

  const data = await fetchClinicDetail(sql, id);
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.update", resourceType: "clinic",
    resourceId: id, requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data, message: "Data berhasil diperbarui." }, 200);
});


crmRoutes.post("/clinics/:id/stage", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) badRequest("ID klinik tidak valid.");

  const body = await readJsonObject(c);
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "stage") || keys.length !== 1) {
    throw new ValidationError("VALIDATION_ERROR", "Body hanya boleh memuat stage.", {
      fields: Object.fromEntries(keys.filter((key) => key !== "stage").map((key) => [key, "Field tidak dikenal."])),
    });
  }

  const stage = body.stage;
  if (typeof stage !== "string" || !STAGES.includes(stage as (typeof STAGES)[number])) {
    throw new ValidationError("INVALID_STAGE", "Tahap klinik tidak valid.", {
      fields: { stage: "Pilih salah satu tahap yang tersedia." },
    });
  }

  const sql = getSql(c.env);
  const rows = await sql`WITH current_clinic AS (
      SELECT id, stage
      FROM clinics
      WHERE id = ${id} AND archived = false
      FOR UPDATE
    ), updated AS (
      UPDATE clinics AS clinic
      SET stage = ${stage}, updated_at = now()
      FROM current_clinic
      WHERE clinic.id = current_clinic.id
      RETURNING clinic.id, current_clinic.stage AS previous_stage, clinic.stage AS stage
    ), activity AS (
      INSERT INTO clinic_activities (clinic_id, type, summary, detail, occurred_at)
      SELECT id, 'stage_change', 'Perubahan tahap klinik',
        previous_stage || ' → ' || stage, now()
      FROM updated
      WHERE previous_stage IS DISTINCT FROM stage
      RETURNING id
    )
    SELECT id, previous_stage, stage FROM updated`;

  const updated = rows[0] as Record<string, unknown> | undefined;
  if (!updated) {
    const existing = await sql`SELECT archived FROM clinics WHERE id = ${id} LIMIT 1`;
    if (!existing[0]) return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");
    if (existing[0].archived) return fail(c, 409, "ARCHIVED_CLINIC", "Klinik arsip tidak dapat diubah.");
    return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");
  }

  await audit(sql, {
    actor: c.get("actor"), action: "clinic.stage_change", resourceType: "clinic",
    resourceId: id, requestId: c.get("requestId"), ok: true,
  });
  return c.json({
    data: { id, previous_stage: updated.previous_stage, stage: updated.stage },
  }, 200);
});


crmRoutes.post("/clinics/:id/archive", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) badRequest("ID klinik tidak valid.");

  const sql = getSql(c.env);
  const rows = await sql`UPDATE clinics
    SET archived = true, updated_at = now()
    WHERE id = ${id}
    RETURNING id, archived`;
  const clinic = rows[0] as Record<string, unknown> | undefined;
  if (!clinic) return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");

  await audit(sql, {
    actor: c.get("actor"), action: "clinic.archive", resourceType: "clinic",
    resourceId: id, requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: { id, archived: true } }, 200);
});


const CONTACT_FIELDS = ["name", "role", "phone", "email", "preferred_channel", "is_primary"] as const;
const CONTACT_CHANNELS = ["whatsapp", "phone", "email"] as const;

function validateContactInput(body: Record<string, unknown>, mode: "create" | "update") {
  const allowed = new Set<string>(CONTACT_FIELDS);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  const fields: Record<string, string> = {};
  for (const key of unknown) fields[key] = "Field tidak dikenal.";
  const result: Record<string, unknown> = {};

  if (mode === "create" && !Object.prototype.hasOwnProperty.call(body, "name")) {
    fields.name = "Nama kontak wajib diisi.";
  }
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const value = body.name;
    if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 120) {
      fields.name = "Nama kontak wajib diisi (maksimal 120 karakter).";
    } else result.name = value.trim();
  }
  for (const key of ["role"] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (value === null || (typeof value === "string" && value.trim() === "")) result[key] = null;
    else if (typeof value !== "string" || value.trim().length > 120) fields[key] = "Maksimal 120 karakter.";
    else result[key] = value.trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "phone")) {
    const value = body.phone;
    if (value === null || (typeof value === "string" && value.trim() === "")) result.phone = null;
    else {
      const phone = normalizePhoneId(value);
      if (!phone) fields.phone = "Nomor WhatsApp Indonesia tidak valid.";
      else result.phone = phone;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "email")) {
    const value = body.email;
    if (value === null || (typeof value === "string" && value.trim() === "")) result.email = null;
    else if (typeof value !== "string" || !isEmail(value.trim())) fields.email = "Email tidak valid.";
    else result.email = value.trim().toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(body, "preferred_channel")) {
    const value = body.preferred_channel;
    if (value === null) result.preferred_channel = null;
    else if (typeof value !== "string" || !CONTACT_CHANNELS.includes(value as (typeof CONTACT_CHANNELS)[number])) {
      fields.preferred_channel = "Kanal harus whatsapp, phone, email, atau null.";
    } else result.preferred_channel = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_primary")) {
    if (typeof body.is_primary !== "boolean") fields.is_primary = "Harus berupa boolean.";
    else result.is_primary = body.is_primary;
  }
  if (Object.keys(fields).length) {
    throw new ValidationError("VALIDATION_ERROR", "Data kontak tidak valid.", { fields });
  }
  if (mode === "update" && Object.keys(result).length === 0) {
    throw new ValidationError("BAD_REQUEST", "Tidak ada perubahan kontak.");
  }
  return result;
}

async function requireActiveClinic(c: Parameters<typeof getSql>[0] extends never ? never : any, sql: ReturnType<typeof getSql>, clinicId: string) {
  const rows = await sql`SELECT archived FROM clinics WHERE id = ${clinicId} LIMIT 1`;
  if (!rows[0]) return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");
  if (rows[0].archived) return fail(c, 409, "ARCHIVED_CLINIC", "Klinik arsip tidak dapat diubah.");
  return null;
}

crmRoutes.get("/clinics/:id/contacts", async (c) => {
  const clinicId = c.req.param("id");
  if (!isUuid(clinicId)) badRequest("ID klinik tidak valid.");
  const sql = getSql(c.env);
  const clinicError = await requireActiveClinic(c, sql, clinicId);
  if (clinicError) return clinicError;
  const contacts = await sql`SELECT id, clinic_id, name, role, phone, email, preferred_channel, is_primary, created_at
    FROM clinic_contacts WHERE clinic_id = ${clinicId}
    ORDER BY is_primary DESC, created_at ASC`;
  return c.json({ data: contacts }, 200);
});

crmRoutes.post("/clinics/:id/contacts", async (c) => {
  const clinicId = c.req.param("id");
  if (!isUuid(clinicId)) badRequest("ID klinik tidak valid.");
  const input = validateContactInput(await readJsonObject(c), "create");
  const sql = getSql(c.env);
  const isPrimary = input.is_primary === true;
  const clinicLock = sql`SELECT id FROM clinics WHERE id = ${clinicId} AND archived = false FOR UPDATE`;
  const unsetPrimary = sql`UPDATE clinic_contacts SET is_primary = false
    WHERE clinic_id = ${clinicId} AND is_primary = true`;
  const insert = sql`INSERT INTO clinic_contacts
      (clinic_id, name, role, phone, email, preferred_channel, is_primary)
    SELECT ${clinicId}, ${input.name}, ${input.role ?? null}, ${input.phone ?? null},
      ${input.email ?? null}, ${input.preferred_channel ?? null}, ${isPrimary}
    WHERE EXISTS (SELECT 1 FROM clinics WHERE id = ${clinicId} AND archived = false)
    RETURNING id, clinic_id, name, role, phone, email, preferred_channel, is_primary, created_at`;
  const results = await (sql as any).transaction(isPrimary
    ? [clinicLock, unsetPrimary, insert]
    : [clinicLock, insert]);
  const createdRows = (results[isPrimary ? 2 : 1] ?? []) as Record<string, unknown>[];
  if (!createdRows[0]) {
    const clinicError = await requireActiveClinic(c, sql, clinicId);
    if (clinicError) return clinicError;
    return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");
  }
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.contact.create", resourceType: "clinic_contact",
    resourceId: String(createdRows[0].id), requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: createdRows[0] }, 201);
});

crmRoutes.patch("/clinics/:id/contacts/:contactId", async (c) => {
  const clinicId = c.req.param("id");
  const contactId = c.req.param("contactId");
  if (!isUuid(clinicId) || !isUuid(contactId)) badRequest("ID kontak tidak valid.");
  const input = validateContactInput(await readJsonObject(c), "update");
  const sql = getSql(c.env);
  const clinicLock = sql`SELECT id FROM clinics WHERE id = ${clinicId} AND archived = false FOR UPDATE`;
  const unsetPrimary = sql`UPDATE clinic_contacts SET is_primary = false
    WHERE clinic_id = ${clinicId} AND id <> ${contactId} AND is_primary = true`;
  const update = sql`UPDATE clinic_contacts SET
      name = CASE WHEN ${Object.hasOwn(input, "name")} THEN ${input.name ?? null} ELSE name END,
      role = CASE WHEN ${Object.hasOwn(input, "role")} THEN ${input.role ?? null} ELSE role END,
      phone = CASE WHEN ${Object.hasOwn(input, "phone")} THEN ${input.phone ?? null} ELSE phone END,
      email = CASE WHEN ${Object.hasOwn(input, "email")} THEN ${input.email ?? null} ELSE email END,
      preferred_channel = CASE WHEN ${Object.hasOwn(input, "preferred_channel")} THEN ${input.preferred_channel ?? null} ELSE preferred_channel END,
      is_primary = CASE WHEN ${Object.hasOwn(input, "is_primary")} THEN ${input.is_primary ?? false} ELSE is_primary END
    WHERE id = ${contactId} AND clinic_id = ${clinicId}
      AND EXISTS (SELECT 1 FROM clinics WHERE id = ${clinicId} AND archived = false)
    RETURNING id, clinic_id, name, role, phone, email, preferred_channel, is_primary, created_at`;
  const statements = input.is_primary === true
    ? [clinicLock, unsetPrimary, update]
    : [clinicLock, update];
  const results = await (sql as any).transaction(statements);
  const updatedRows = (results[input.is_primary === true ? 2 : 1] ?? []) as Record<string, unknown>[];
  if (!updatedRows[0]) {
    const clinicError = await requireActiveClinic(c, sql, clinicId);
    if (clinicError) return clinicError;
    return fail(c, 404, "CONTACT_NOT_FOUND", "Kontak tidak ditemukan.");
  }
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.contact.update", resourceType: "clinic_contact",
    resourceId: contactId, requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: updatedRows[0] }, 200);
});

crmRoutes.delete("/clinics/:id/contacts/:contactId", async (c) => {
  const clinicId = c.req.param("id");
  const contactId = c.req.param("contactId");
  if (!isUuid(clinicId) || !isUuid(contactId)) badRequest("ID kontak tidak valid.");
  const sql = getSql(c.env);
  const clinicError = await requireActiveClinic(c, sql, clinicId);
  if (clinicError) return clinicError;
  const rows = await sql`DELETE FROM clinic_contacts
    WHERE id = ${contactId} AND clinic_id = ${clinicId}
    RETURNING id`;
  if (!rows[0]) return fail(c, 404, "CONTACT_NOT_FOUND", "Kontak tidak ditemukan.");
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.contact.delete", resourceType: "clinic_contact",
    resourceId: contactId, requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: { id: contactId, deleted: true } }, 200);
});

export { crmRoutes };
