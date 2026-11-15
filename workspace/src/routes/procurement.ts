import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/http";
import { fail } from "../lib/http";
import { getSql } from "../lib/db";
import { writeAudit } from "../lib/audit";
import { computeLanded } from "../lib/landed";
import { checkGoldenRules } from "../lib/goldenRules";

/* Jalur pengadaan: tahap SOP supplier, gerbang, penawaran landed cost, dan layar "Hari ini".
   Terpisah dari /api/ops agar tabel yang belum dimigrasi (006) tidak merusak CRUD yang ada. */
export const procurementRoutes = new Hono<AppEnv>();

const uuid = z.string().uuid();
const stage = z.enum(["aktif", "tertahan", "berhenti", "ditutup"]);
const gate = z.enum(["halal", "loa_bpom", "cfs", "coa_iso", "pembayaran_aman"]);
const gateState = z.enum(["belum", "diminta", "diterima", "tidak_ada"]);

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const landedInput = z.object({
  fob: num(0, 1e9), qty: num(1, 1e9), kurs: num(1, 1e6), freight: num(0, 1e9), insPct: num(0, 100),
  dutyPct: num(0, 100), ppnPct: num(0, 100), pphPct: num(0, 100), other: num(0, 1e15), margin: num(0, 99.99),
  taxCost: z.boolean(),
}).strict();
const quoteInput = z.object({
  supplier_id: uuid.nullable().optional(),
  product: z.string().trim().min(1).max(160),
  inputs: landedInput,
}).strict();

type Ctx = Parameters<typeof fail>[0];
const badInput = (c: Ctx) => fail(c, 400, "INVALID_INPUT", "Data tidak valid. Periksa kolom wajib dan batas nilai.");
const unavailable = (c: Ctx, what: string) =>
  fail(c, 503, "DATABASE_UNAVAILABLE", `${what} belum tersedia. Pastikan migrasi 006 sudah dijalankan.`);

async function auditMutation(c: Ctx, action: string, resourceType: string, resourceId: string) {
  try {
    await writeAudit(getSql(c.env), { actor: c.get("actor") ?? "unknown", action, resourceType, resourceId, requestId: c.get("requestId"), ok: true });
  } catch {
    console.error("Workspace mutation audit failed", { requestId: c.get("requestId"), action, resourceType });
  }
}

procurementRoutes.get("/sop", async (c) => {
  try {
    const rows = await getSql(c.env)`SELECT s.id, s.name, s.country, s.status, s.sop_stage,
        COALESCE((SELECT json_agg(json_build_object('gate', g.gate, 'state', g.state, 'note', g.note, 'updated_at', g.updated_at))
                  FROM workspace_supplier_gates g WHERE g.supplier_id = s.id), '[]'::json) AS gates
      FROM workspace_suppliers s ORDER BY s.updated_at DESC LIMIT 250`;
    return c.json({ data: rows });
  } catch {
    return unavailable(c, "Tahap SOP supplier");
  }
});

procurementRoutes.patch("/sop/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success) return fail(c, 400, "INVALID_ID", "ID supplier tidak valid");
  const parsed = z.object({ sop_stage: stage }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badInput(c);
  try {
    const rows = await getSql(c.env)`UPDATE workspace_suppliers SET sop_stage=${parsed.data.sop_stage}::text, updated_at=now()
      WHERE id=${c.req.param("id")}::uuid RETURNING id, sop_stage`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Supplier tidak ditemukan");
    await auditMutation(c, "update", "supplier_stage", String(rows[0].id));
    return c.json({ data: rows[0] });
  } catch {
    return unavailable(c, "Tahap SOP supplier");
  }
});

procurementRoutes.put("/sop/:id/gates/:gate", async (c) => {
  const id = uuid.safeParse(c.req.param("id"));
  const g = gate.safeParse(c.req.param("gate"));
  if (!id.success || !g.success) return fail(c, 400, "INVALID_ID", "Supplier atau gerbang tidak valid");
  const parsed = z.object({ state: gateState, note: z.string().trim().max(1000).optional() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badInput(c);
  const note = parsed.data.note ?? null;
  try {
    const rows = await getSql(c.env)`INSERT INTO workspace_supplier_gates (supplier_id, gate, state, note)
      SELECT s.id, ${g.data}::text, ${parsed.data.state}::text, COALESCE(${note}::text, '')
      FROM workspace_suppliers s WHERE s.id=${id.data}::uuid
      ON CONFLICT (supplier_id, gate) DO UPDATE
        SET state=EXCLUDED.state, note=COALESCE(${note}::text, workspace_supplier_gates.note), updated_at=now()
      RETURNING supplier_id, gate, state, note, updated_at`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Supplier tidak ditemukan");
    await auditMutation(c, "update", "supplier_gate", `${id.data}:${g.data}`);
    return c.json({ data: rows[0] });
  } catch {
    return unavailable(c, "Gerbang supplier");
  }
});

procurementRoutes.get("/quotes", async (c) => {
  try {
    const rows = await getSql(c.env)`SELECT q.id, q.supplier_id, s.name AS supplier_name, q.product, q.inputs,
        q.total_idr, q.unit_idr, q.price_idr, q.created_by, q.created_at
      FROM workspace_landed_quotes q LEFT JOIN workspace_suppliers s ON s.id = q.supplier_id
      ORDER BY q.created_at DESC LIMIT 200`;
    return c.json({ data: rows });
  } catch {
    return unavailable(c, "Penawaran tersimpan");
  }
});

procurementRoutes.post("/quotes", async (c) => {
  const parsed = quoteInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badInput(c);
  const d = parsed.data;
  const r = computeLanded(d.inputs);
  if (![r.total, r.unit].every(Number.isFinite)) return badInput(c);
  const price = Number.isFinite(r.price) ? r.price : null;
  const supplierId = d.supplier_id ?? null;
  try {
    const rows = await getSql(c.env)`INSERT INTO workspace_landed_quotes (supplier_id, product, inputs, total_idr, unit_idr, price_idr, created_by)
      SELECT ${supplierId}::uuid, ${d.product}::text, ${JSON.stringify(d.inputs)}::jsonb, ${r.total}::float8, ${r.unit}::float8, ${price}::float8, ${c.get("actor") ?? "unknown"}::text
      WHERE ${supplierId}::uuid IS NULL OR EXISTS (SELECT 1 FROM workspace_suppliers WHERE id=${supplierId}::uuid)
      RETURNING id, supplier_id, product, inputs, total_idr, unit_idr, price_idr, created_by, created_at`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Supplier tidak ditemukan");
    await auditMutation(c, "create", "landed_quote", String(rows[0].id));
    return c.json({ data: rows[0] }, 201);
  } catch {
    return unavailable(c, "Penawaran tersimpan");
  }
});

procurementRoutes.delete("/quotes/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success) return fail(c, 400, "INVALID_ID", "ID penawaran tidak valid");
  try {
    const rows = await getSql(c.env)`DELETE FROM workspace_landed_quotes WHERE id=${c.req.param("id")}::uuid RETURNING id`;
    if (!rows.length) return fail(c, 404, "NOT_FOUND", "Penawaran tidak ditemukan");
    await auditMutation(c, "delete", "landed_quote", String(rows[0].id));
    return c.json({ ok: true });
  } catch {
    return unavailable(c, "Penawaran tersimpan");
  }
});

/* Layar "Hari ini": tiap bagian diambil sendiri-sendiri agar satu tabel yang belum
   dimigrasi tidak mengosongkan bagian lain. `unavailable` menyebut bagian yang gagal. */
procurementRoutes.get("/today", async (c) => {
  const sql = getSql(c.env);
  const actor = c.get("actor") ?? "unknown";
  const [followups, approvals, waiting, held] = await Promise.allSettled([
    sql`SELECT a.id, a.entity_type, a.entity_id, a.activity_type, a.title, a.due_at,
          COALESCE(s.name, cl.name) AS entity_name, (a.due_at < now()) AS overdue
        FROM workspace_activities a
        LEFT JOIN workspace_suppliers s ON a.entity_type='supplier' AND s.id=a.entity_id
        LEFT JOIN workspace_clinics cl ON a.entity_type='clinic' AND cl.id=a.entity_id
        WHERE a.completed_at IS NULL AND a.due_at IS NOT NULL
          AND a.due_at < ((date_trunc('day', now() AT TIME ZONE 'Asia/Makassar') + interval '1 day') AT TIME ZONE 'Asia/Makassar')
        ORDER BY a.due_at ASC LIMIT 30`,
    sql`SELECT id, action_type, created_at, expires_at FROM assistant_approvals
        WHERE actor=${actor} AND status='pending' AND expires_at > now()
        ORDER BY created_at DESC LIMIT 10`,
    sql`SELECT s.id AS supplier_id, s.name, g.gate, g.updated_at
        FROM workspace_supplier_gates g JOIN workspace_suppliers s ON s.id = g.supplier_id
        WHERE g.state='diminta' AND s.sop_stage='aktif'
        ORDER BY g.updated_at ASC LIMIT 20`,
    sql`SELECT count(*)::int AS n FROM workspace_suppliers WHERE sop_stage='tertahan'`,
  ]);
  const missing: string[] = [];
  const take = <T,>(name: string, r: PromiseSettledResult<T>, fallback: T): T => {
    if (r.status === "fulfilled") return r.value;
    missing.push(name);
    return fallback;
  };
  const f = take("followups", followups, [] as Record<string, unknown>[]);
  const a = take("approvals", approvals, [] as Record<string, unknown>[]);
  const w = take("waiting_docs", waiting, [] as Record<string, unknown>[]);
  const h = take("held", held, [{ n: 0 }] as Record<string, unknown>[]);
  return c.json({ followups: f, approvals: a, waiting_docs: w, held: Number(h[0]?.n ?? 0), unavailable: missing });
});

/* Pemeriksa Aturan Emas: deterministik, tanpa DB dan tanpa AI. Teks tidak disimpan maupun dicatat di audit. */
const checkInput = z.object({ text: z.string().trim().min(1).max(20000), direction: z.enum(["draft", "incoming"]) }).strict();
procurementRoutes.post("/check", async (c) => {
  const parsed = checkInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badInput(c);
  return c.json({ data: checkGoldenRules(parsed.data.text, { direction: parsed.data.direction }) });
});
