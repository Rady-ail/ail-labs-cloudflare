import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError } from "../../lib/http";
import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";
import { readJsonObject } from "../../lib/body";
import { isUuid, clampInt } from "../../lib/validate";
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

export { crmRoutes };
