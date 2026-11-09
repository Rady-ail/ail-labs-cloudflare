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
    WHERE clinic_id = ${clinicId} AND is_primary = true
      AND EXISTS (SELECT 1 FROM clinics WHERE id = ${clinicId} AND archived = false)`;
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
    WHERE clinic_id = ${clinicId} AND id <> ${contactId} AND is_primary = true
      AND EXISTS (SELECT 1 FROM clinics WHERE id = ${clinicId} AND archived = false)
      AND EXISTS (SELECT 1 FROM clinic_contacts WHERE id = ${contactId} AND clinic_id = ${clinicId})`;
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


const ACTIVITY_TYPES = ["call", "whatsapp", "email", "visit", "order", "note", "stage_change"] as const;

crmRoutes.post("/clinics/:id/activities", async (c) => {
  const clinicId = c.req.param("id");
  if (!isUuid(clinicId)) badRequest("ID klinik tidak valid.");
  const body = await readJsonObject(c);
  const allowed = new Set(["type", "summary", "detail", "occurred_at"]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  const fields: Record<string, string> = {};
  for (const key of unknown) fields[key] = "Field tidak dikenal.";

  if (typeof body.type !== "string" || !ACTIVITY_TYPES.includes(body.type as (typeof ACTIVITY_TYPES)[number])) {
    fields.type = "Jenis aktivitas tidak valid.";
  }
  if (typeof body.summary !== "string" || body.summary.trim().length < 1 || body.summary.trim().length > 240) {
    fields.summary = "Ringkasan wajib diisi (maksimal 240 karakter).";
  }
  if (body.detail !== undefined && body.detail !== null &&
    (typeof body.detail !== "string" || body.detail.length > 4000)) {
    fields.detail = "Detail maksimal 4000 karakter.";
  }
  let occurredAt: string | null = null;
  if (body.occurred_at !== undefined) {
    if (typeof body.occurred_at !== "string" || Number.isNaN(Date.parse(body.occurred_at))) {
      fields.occurred_at = "Waktu aktivitas tidak valid.";
    } else occurredAt = new Date(body.occurred_at).toISOString();
  }
  if (Object.keys(fields).length) {
    throw new ValidationError("VALIDATION_ERROR", "Data aktivitas tidak valid.", { fields });
  }

  const type = body.type as (typeof ACTIVITY_TYPES)[number];
  const summary = (body.summary as string).trim();
  const detail = typeof body.detail === "string" ? body.detail.trim() || null : null;
  const sql = getSql(c.env);
  const rows = await sql`WITH inserted AS (
      INSERT INTO clinic_activities (clinic_id, type, summary, detail, occurred_at)
      SELECT ${clinicId}, ${type}, ${summary}, ${detail}, COALESCE(${occurredAt}::timestamptz, now())
      WHERE EXISTS (SELECT 1 FROM clinics WHERE id = ${clinicId} AND archived = false)
      RETURNING id, clinic_id, type, summary, detail, occurred_at, created_at
    ), activity_rows AS (
      SELECT type, occurred_at FROM clinic_activities WHERE clinic_id = ${clinicId}
      UNION ALL
      SELECT type, occurred_at FROM inserted
    ), stats AS (
      SELECT
        count(*) FILTER (WHERE type IN ('call', 'whatsapp', 'email'))::int AS interactions_count,
        count(*) FILTER (WHERE type = 'order')::int AS orders_count,
        max(occurred_at) FILTER (WHERE type IN ('call', 'whatsapp', 'email', 'visit', 'order')) AS last_contact_at
      FROM activity_rows
    ), updated AS (
      UPDATE clinics
      SET interactions_count = stats.interactions_count,
          orders_count = stats.orders_count,
          last_contact_at = stats.last_contact_at,
          updated_at = now()
      FROM stats
      WHERE clinics.id = ${clinicId} AND EXISTS (SELECT 1 FROM inserted)
      RETURNING clinics.id
    )
    SELECT inserted.* FROM inserted JOIN updated ON updated.id = inserted.clinic_id`;

  const activity = rows[0] as Record<string, unknown> | undefined;
  if (!activity) {
    const existing = await sql`SELECT archived FROM clinics WHERE id = ${clinicId} LIMIT 1`;
    if (!existing[0]) return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");
    if (existing[0].archived) return fail(c, 409, "ARCHIVED_CLINIC", "Klinik arsip tidak dapat diubah.");
    return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");
  }

  await audit(sql, {
    actor: c.get("actor"), action: "clinic.activity.create", resourceType: "clinic_activity",
    resourceId: String(activity.id), requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: activity }, 201);
});


function validateFollowUpInput(body: Record<string, unknown>, mode: "create" | "update") {
  const allowed = new Set(["scheduled_at", "reason"]);
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) if (!allowed.has(key)) fields[key] = "Field tidak dikenal.";
  const result: { scheduled_at?: string; reason?: string } = {};

  if (mode === "create" && (!Object.hasOwn(body, "scheduled_at") || !Object.hasOwn(body, "reason"))) {
    if (!Object.hasOwn(body, "scheduled_at")) fields.scheduled_at = "Tanggal follow-up wajib diisi.";
    if (!Object.hasOwn(body, "reason")) fields.reason = "Alasan follow-up wajib diisi.";
  }
  if (Object.hasOwn(body, "scheduled_at")) {
    const value = body.scheduled_at;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      fields.scheduled_at = "Tanggal follow-up tidak valid.";
    } else result.scheduled_at = new Date(value).toISOString();
  }
  if (Object.hasOwn(body, "reason")) {
    const value = body.reason;
    if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 240) {
      fields.reason = "Alasan wajib diisi (maksimal 240 karakter).";
    } else result.reason = value.trim();
  }
  if (Object.keys(fields).length) {
    throw new ValidationError("VALIDATION_ERROR", "Data follow-up tidak valid.", { fields });
  }
  if (mode === "update" && Object.keys(result).length === 0) {
    throw new ValidationError("BAD_REQUEST", "Tidak ada perubahan follow-up.");
  }
  return result;
}

crmRoutes.post("/clinics/:id/follow-ups", async (c) => {
  const clinicId = c.req.param("id");
  if (!isUuid(clinicId)) badRequest("ID klinik tidak valid.");
  const input = validateFollowUpInput(await readJsonObject(c), "create");
  const sql = getSql(c.env);
  const rows = await sql`WITH active_clinic AS (
      SELECT id FROM clinics WHERE id = ${clinicId} AND archived = false FOR UPDATE
    ), pending AS (
      SELECT f.id FROM clinic_followups f
      JOIN active_clinic clinic ON clinic.id = f.clinic_id
      WHERE f.completed = false
      ORDER BY f.scheduled_at ASC
      LIMIT 1
      FOR UPDATE
    ), updated AS (
      UPDATE clinic_followups
      SET scheduled_at = ${input.scheduled_at}, reason = ${input.reason}
      WHERE id = (SELECT id FROM pending)
      RETURNING id, clinic_id, scheduled_at, reason, completed, completed_at, created_at
    ), inserted AS (
      INSERT INTO clinic_followups (clinic_id, scheduled_at, reason)
      SELECT ${clinicId}, ${input.scheduled_at}, ${input.reason}
      FROM active_clinic
      WHERE NOT EXISTS (SELECT 1 FROM pending)
      RETURNING id, clinic_id, scheduled_at, reason, completed, completed_at, created_at
    ), saved AS (
      SELECT * FROM updated
      UNION ALL
      SELECT * FROM inserted
    ), synced AS (
      UPDATE clinics
      SET next_followup_at = (
            SELECT scheduled_at FROM clinic_followups
            WHERE clinic_id = ${clinicId} AND completed = false
            ORDER BY scheduled_at ASC LIMIT 1
          ),
          next_followup_reason = (
            SELECT reason FROM clinic_followups
            WHERE clinic_id = ${clinicId} AND completed = false
            ORDER BY scheduled_at ASC LIMIT 1
          ),
          updated_at = now()
      WHERE id = ${clinicId} AND EXISTS (SELECT 1 FROM saved)
      RETURNING id
    )
    SELECT saved.* FROM saved JOIN synced ON synced.id = saved.clinic_id`;

  const followup = rows[0] as Record<string, unknown> | undefined;
  if (!followup) {
    const clinicError = await requireActiveClinic(c, sql, clinicId);
    if (clinicError) return clinicError;
    return fail(c, 404, "CLINIC_NOT_FOUND", "Klinik tidak ditemukan.");
  }
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.followup.set", resourceType: "clinic_followup",
    resourceId: String(followup.id), requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: followup }, 201);
});

crmRoutes.patch("/follow-ups/:id", async (c) => {
  const followupId = c.req.param("id");
  if (!isUuid(followupId)) badRequest("ID follow-up tidak valid.");
  const input = validateFollowUpInput(await readJsonObject(c), "update");
  const sql = getSql(c.env);
  const scheduledAt = input.scheduled_at ?? null;
  const reason = input.reason ?? null;
  const rows = await sql`WITH updated AS (
      UPDATE clinic_followups AS f
      SET scheduled_at = COALESCE(${scheduledAt}::timestamptz, f.scheduled_at),
          reason = COALESCE(${reason}::text, f.reason)
      WHERE f.id = ${followupId} AND f.completed = false
        AND EXISTS (SELECT 1 FROM clinics WHERE id = f.clinic_id AND archived = false)
      RETURNING f.id, f.clinic_id, f.scheduled_at, f.reason, f.completed, f.completed_at, f.created_at
    ), synced AS (
      UPDATE clinics AS c
      SET next_followup_at = (
            SELECT scheduled_at FROM clinic_followups
            WHERE clinic_id = c.id AND completed = false
            ORDER BY scheduled_at ASC LIMIT 1
          ),
          next_followup_reason = (
            SELECT reason FROM clinic_followups
            WHERE clinic_id = c.id AND completed = false
            ORDER BY scheduled_at ASC LIMIT 1
          ),
          updated_at = now()
      WHERE c.id = (SELECT clinic_id FROM updated)
      RETURNING c.id
    )
    SELECT updated.* FROM updated JOIN synced ON synced.id = updated.clinic_id`;
  const followup = rows[0] as Record<string, unknown> | undefined;
  if (!followup) return fail(c, 404, "FOLLOWUP_NOT_FOUND", "Follow-up aktif tidak ditemukan.");
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.followup.update", resourceType: "clinic_followup",
    resourceId: followupId, requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: followup }, 200);
});

crmRoutes.post("/follow-ups/:id/complete", async (c) => {
  const followupId = c.req.param("id");
  if (!isUuid(followupId)) badRequest("ID follow-up tidak valid.");
  const sql = getSql(c.env);
  const rows = await sql`WITH completed AS (
      UPDATE clinic_followups AS f
      SET completed = true, completed_at = COALESCE(f.completed_at, now())
      WHERE f.id = ${followupId}
        AND EXISTS (SELECT 1 FROM clinics WHERE id = f.clinic_id AND archived = false)
      RETURNING f.id, f.clinic_id, f.scheduled_at, f.reason, f.completed, f.completed_at, f.created_at
    ), synced AS (
      UPDATE clinics AS c
      SET next_followup_at = (
            SELECT scheduled_at FROM clinic_followups
            WHERE clinic_id = c.id AND completed = false
            ORDER BY scheduled_at ASC LIMIT 1
          ),
          next_followup_reason = (
            SELECT reason FROM clinic_followups
            WHERE clinic_id = c.id AND completed = false
            ORDER BY scheduled_at ASC LIMIT 1
          ),
          updated_at = now()
      WHERE c.id = (SELECT clinic_id FROM completed)
      RETURNING c.id
    )
    SELECT completed.* FROM completed JOIN synced ON synced.id = completed.clinic_id`;
  const followup = rows[0] as Record<string, unknown> | undefined;
  if (!followup) return fail(c, 404, "FOLLOWUP_NOT_FOUND", "Follow-up tidak ditemukan.");
  await audit(sql, {
    actor: c.get("actor"), action: "clinic.followup.complete", resourceType: "clinic_followup",
    resourceId: followupId, requestId: c.get("requestId"), ok: true,
  });
  return c.json({ data: followup }, 200);
});

crmRoutes.get("/follow-ups", async (c) => {
  const query = c.req.query();
  const allowed = new Set(["status", "from", "to", "limit"]);
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new ValidationError("BAD_REQUEST", "Parameter tidak dikenal.", {
      fields: Object.fromEntries(unknown.map((key) => [key, "Parameter tidak dikenal."])),
    });
  }
  const status = query.status ?? "pending";
  if (status !== "pending" && status !== "completed" && status !== "all") {
    throw new ValidationError("BAD_REQUEST", "Filter status tidak valid.", {
      fields: { status: "Gunakan pending, completed, atau all." },
    });
  }
  const from = query.from ?? null;
  const to = query.to ?? null;
  if ((from !== null && Number.isNaN(Date.parse(from))) || (to !== null && Number.isNaN(Date.parse(to)))) {
    throw new ValidationError("BAD_REQUEST", "Rentang tanggal tidak valid.", {
      fields: { date: "Gunakan tanggal ISO yang valid." },
    });
  }
  const limit = clampInt(query.limit, 1, 200, 100);
  const sql = getSql(c.env);
  const rows = await sql`SELECT f.id, f.clinic_id, c.name AS clinic_name, c.city, c.province,
      f.scheduled_at, f.reason, f.completed, f.completed_at, f.created_at
    FROM clinic_followups f
    JOIN clinics c ON c.id = f.clinic_id
    WHERE c.archived = false
      AND (${status} = 'all' OR (${status} = 'pending' AND f.completed = false)
        OR (${status} = 'completed' AND f.completed = true))
      AND (${from}::timestamptz IS NULL OR f.scheduled_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR f.scheduled_at <= ${to}::timestamptz)
    ORDER BY f.completed ASC, f.scheduled_at ASC
    LIMIT ${limit}`;
  return c.json({ data: rows }, 200);
});


crmRoutes.get("/regions/summary", async (c) => {
  const query = c.req.query();
  const unknown = Object.keys(query);
  if (unknown.length) {
    throw new ValidationError("BAD_REQUEST", "Parameter tidak dikenal.", {
      fields: Object.fromEntries(unknown.map((key) => [key, "Parameter tidak dikenal."])),
    });
  }
  const sql = getSql(c.env);
  const rows = await sql`SELECT
      province,
      count(*)::int AS clinics_count,
      count(*) FILTER (WHERE stage = 'lead')::int AS lead_count,
      count(*) FILTER (WHERE stage = 'contacted')::int AS contacted_count,
      count(*) FILTER (WHERE stage = 'catalog_sent')::int AS catalog_sent_count,
      count(*) FILTER (WHERE stage = 'negotiating')::int AS negotiating_count,
      count(*) FILTER (WHERE stage = 'ordered')::int AS ordered_count,
      count(*) FILTER (WHERE stage = 'active')::int AS active_count,
      count(*) FILTER (WHERE stage = 'inactive')::int AS inactive_count,
      COALESCE(sum(interactions_count), 0)::int AS interactions_count,
      COALESCE(sum(orders_count), 0)::int AS orders_count,
      count(*) FILTER (WHERE next_followup_at IS NOT NULL)::int AS clinics_with_followup
    FROM clinics
    WHERE archived = false
    GROUP BY province
    ORDER BY province ASC`;
  return c.json({ data: rows }, 200);
});

export { crmRoutes };
