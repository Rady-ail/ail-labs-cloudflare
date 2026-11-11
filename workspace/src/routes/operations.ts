import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/http";
import { fail } from "../lib/http";
import { getSql } from "../lib/db";
import { writeAudit } from "../lib/audit";

export const operationsRoutes = new Hono<AppEnv>();

const supplierStatus = z.enum(["prospect", "contacted", "negotiating", "sample", "approved", "rejected"]);
const clinicStatus = z.enum(["lead", "contacted", "follow_up", "customer", "inactive"]);
const supplierInput = z.object({
  name: z.string().trim().min(1).max(160),
  country: z.string().trim().max(100).optional(),
  email: z.string().trim().max(254).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  website: z.string().trim().max(500).optional(),
  status: supplierStatus.optional(),
  notes: z.string().trim().max(5000).optional(),
}).strict();
const clinicInput = z.object({
  name: z.string().trim().min(1).max(160),
  city: z.string().trim().max(100).optional(),
  province: z.string().trim().max(100).optional(),
  contact_name: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(254).optional(),
  status: clinicStatus.optional(),
  notes: z.string().trim().max(5000).optional(),
}).strict();
const uuid = z.string().uuid();

async function auditMutation(c: Parameters<typeof fail>[0], action: string, resourceType: string, resourceId: string) {
  try {
    await writeAudit(getSql(c.env), { actor: c.get("actor") ?? "unknown", action, resourceType, resourceId, requestId: c.get("requestId"), ok: true });
  } catch {
    console.error("Workspace mutation audit failed", { requestId: c.get("requestId"), action, resourceType });
  }
}

function badInput(c: Parameters<typeof fail>[0]) {
  return fail(c, 400, "INVALID_INPUT", "Data tidak valid. Periksa kolom wajib dan batas panjang.");
}

operationsRoutes.get("/suppliers", async (c) => {
  try {
    const rows = await getSql(c.env)`SELECT id,name,country,email,whatsapp,website,status,notes,created_at,updated_at FROM workspace_suppliers ORDER BY updated_at DESC LIMIT 250`;
    return c.json({ data: rows });
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Data supplier belum tersedia. Pastikan migrasi database sudah dijalankan.");
  }
});
operationsRoutes.post("/suppliers", async (c) => {
  const parsed = supplierInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badInput(c);
  const d = parsed.data;
  try {
    const rows = await getSql(c.env)`INSERT INTO workspace_suppliers (name,country,email,whatsapp,website,status,notes)
      VALUES (${d.name},${d.country ?? ""},${d.email ?? ""},${d.whatsapp ?? ""},${d.website ?? ""},${d.status ?? "prospect"},${d.notes ?? ""})
      RETURNING id,name,country,email,whatsapp,website,status,notes,created_at,updated_at`;
    await auditMutation(c, "create", "supplier", String(rows[0].id));
    return c.json({ data: rows[0] }, 201);
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Supplier gagal disimpan. Periksa migrasi database.");
  }
});
operationsRoutes.patch("/suppliers/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success) return fail(c, 400, "INVALID_ID", "ID supplier tidak valid");
  const parsed = supplierInput.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) return badInput(c);
  const d = parsed.data;
  try {
    const rows = await getSql(c.env)`UPDATE workspace_suppliers SET
      name=COALESCE(${d.name ?? null},name),country=COALESCE(${d.country ?? null},country),
      email=COALESCE(${d.email ?? null},email),whatsapp=COALESCE(${d.whatsapp ?? null},whatsapp),
      website=COALESCE(${d.website ?? null},website),status=COALESCE(${d.status ?? null},status),
      notes=COALESCE(${d.notes ?? null},notes),updated_at=now()
      WHERE id=${c.req.param("id")} RETURNING id,name,country,email,whatsapp,website,status,notes,created_at,updated_at`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Supplier tidak ditemukan");
    await auditMutation(c, "update", "supplier", String(rows[0].id));
    return c.json({ data: rows[0] });
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Perubahan supplier gagal disimpan");
  }
});
operationsRoutes.delete("/suppliers/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success) return fail(c, 400, "INVALID_ID", "ID supplier tidak valid");
  try {
    const rows = await getSql(c.env)`DELETE FROM workspace_suppliers WHERE id=${c.req.param("id")} RETURNING id`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Supplier tidak ditemukan");
    await auditMutation(c, "delete", "supplier", String(rows[0].id));
    return c.json({ ok: true });
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Supplier gagal dihapus");
  }
});

operationsRoutes.get("/clinics", async (c) => {
  try {
    const rows = await getSql(c.env)`SELECT id,name,city,province,contact_name,phone,email,status,notes,created_at,updated_at FROM workspace_clinics ORDER BY updated_at DESC LIMIT 250`;
    return c.json({ data: rows });
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Data klinik belum tersedia. Pastikan migrasi database sudah dijalankan.");
  }
});
operationsRoutes.post("/clinics", async (c) => {
  const parsed = clinicInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badInput(c);
  const d = parsed.data;
  try {
    const rows = await getSql(c.env)`INSERT INTO workspace_clinics (name,city,province,contact_name,phone,email,status,notes)
      VALUES (${d.name},${d.city ?? ""},${d.province ?? ""},${d.contact_name ?? ""},${d.phone ?? ""},${d.email ?? ""},${d.status ?? "lead"},${d.notes ?? ""})
      RETURNING id,name,city,province,contact_name,phone,email,status,notes,created_at,updated_at`;
    if (!rows.length) return fail(c, 503, "DATABASE_WRITE_FAILED", "Klinik tidak berhasil dibuat");
    await auditMutation(c, "create", "clinic", String(rows[0].id));
    return c.json({ data: rows[0] }, 201);
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Klinik gagal disimpan. Periksa migrasi database.");
  }
});
operationsRoutes.patch("/clinics/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success) return fail(c, 400, "INVALID_ID", "ID klinik tidak valid");
  const parsed = clinicInput.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) return badInput(c);
  const d = parsed.data;
  try {
    const rows = await getSql(c.env)`UPDATE workspace_clinics SET
      name=COALESCE(${d.name ?? null},name),city=COALESCE(${d.city ?? null},city),
      province=COALESCE(${d.province ?? null},province),contact_name=COALESCE(${d.contact_name ?? null},contact_name),
      phone=COALESCE(${d.phone ?? null},phone),email=COALESCE(${d.email ?? null},email),
      status=COALESCE(${d.status ?? null},status),notes=COALESCE(${d.notes ?? null},notes),updated_at=now()
      WHERE id=${c.req.param("id")} RETURNING id,name,city,province,contact_name,phone,email,status,notes,created_at,updated_at`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Klinik tidak ditemukan");
    await auditMutation(c, "update", "clinic", String(rows[0].id));
    return c.json({ data: rows[0] });
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Perubahan klinik gagal disimpan");
  }
});
operationsRoutes.delete("/clinics/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success) return fail(c, 400, "INVALID_ID", "ID klinik tidak valid");
  try {
    const rows = await getSql(c.env)`DELETE FROM workspace_clinics WHERE id=${c.req.param("id")} RETURNING id`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Klinik tidak ditemukan");
    await auditMutation(c, "delete", "clinic", String(rows[0].id));
    return c.json({ ok: true });
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Klinik gagal dihapus");
  }
});

operationsRoutes.get("/status", async (c) => {
  let database = false;
  try { await getSql(c.env)`SELECT 1`; database = true; } catch { /* status only */ }
  return c.json({
    database, ai: Boolean(c.env.OPENAI_API_KEY),
    aiRateLimiter: Boolean(c.env.AI_RATE_LIMITER),
    email: Boolean(c.env.RESEND_API_KEY),
    emailMode: c.env.EMAIL_SEND_MODE || "dry-run",
  });
});
