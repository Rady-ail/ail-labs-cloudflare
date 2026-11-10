import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError, ok } from "../../lib/http";
import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";

// Paket & bea: pelacakan AWB sampel dan keputusan soal bea/pajak. Aplikasi hanya MENCATAT keputusan;
// tidak ada pembayaran yang dijalankan dari sini.
export const paketRoutes = new Hono<AppEnv>();
const DECISIONS = ["tidak_ada", "belum", "tidak_bayar", "bayar_disetujui", "dibayar"] as const;

paketRoutes.get("/", async (c) => {
  const sql = getSql(c.env);
  const rows = await sql`SELECT ss.id::text AS id, s.name AS supplier, ss.description, ss.state, ss.awb, ss.courier,
      ss.eta, ss.note, ss.duty_amount_idr, ss.duty_decision, ss.updated_at,
      floor(extract(epoch FROM (now() - ss.updated_at)) / 86400)::int AS hari
    FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id
    WHERE ss.awb IS NOT NULL AND s.archived_at IS NULL AND s.name !~* '(liyin|yolanda)'
    ORDER BY (ss.duty_decision = 'belum') DESC, ss.updated_at DESC LIMIT 100`;
  const items = rows.map((r: Record<string, any>) => ({
    id: String(r.id), supplier: r.supplier, description: r.description, state: r.state, awb: r.awb, courier: r.courier ?? null,
    eta: r.eta ? String(r.eta).slice(0, 10) : null, note: r.note ?? null,
    duty_amount_idr: r.duty_amount_idr == null ? null : Number(r.duty_amount_idr), duty_decision: r.duty_decision,
    updated_at: new Date(r.updated_at).toISOString(), hari: Number(r.hari ?? 0),
  }));
  return ok(c, { items, menunggu_keputusan: items.filter((i: any) => i.duty_decision === "belum").length });
});

paketRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ValidationError("BAD_REQUEST", "ID tidak valid.");
  let body: Record<string, any> = {};
  try { body = await c.req.json(); } catch { throw new ValidationError("BAD_REQUEST", "JSON tidak valid."); }
  const unknown = Object.keys(body).filter((k) => !["duty_amount_idr", "duty_decision"].includes(k));
  if (unknown.length) throw new ValidationError("VALIDATION_ERROR", "Kolom tidak dikenal.", { fields: Object.fromEntries(unknown.map((k) => [k, "Tidak dikenal."])) });
  const fields: Record<string, string> = {};
  let amount: number | null | undefined;
  if ("duty_amount_idr" in body) {
    if (body.duty_amount_idr === null) amount = null;
    else if (Number.isInteger(body.duty_amount_idr) && body.duty_amount_idr >= 0 && body.duty_amount_idr <= 10_000_000_000) amount = body.duty_amount_idr;
    else fields.duty_amount_idr = "Harus bilangan bulat rupiah (>= 0).";
  }
  let decision: string | undefined;
  if ("duty_decision" in body) {
    if (typeof body.duty_decision === "string" && (DECISIONS as readonly string[]).includes(body.duty_decision)) decision = body.duty_decision;
    else fields.duty_decision = "Keputusan tidak valid.";
  }
  if (Object.keys(fields).length) throw new ValidationError("VALIDATION_ERROR", "Data tidak valid.", { fields });
  if (amount === undefined && decision === undefined) throw new ValidationError("VALIDATION_ERROR", "Tidak ada perubahan.", { fields: { body: "Kosong." } });
  const sql = getSql(c.env);
  const rows = await sql`UPDATE supplier_samples SET
      duty_amount_idr = CASE WHEN ${amount !== undefined} THEN ${amount ?? null}::bigint ELSE duty_amount_idr END,
      duty_decision = COALESCE(${decision ?? null}::text, duty_decision), updated_at = now()
    WHERE id = ${id}::uuid AND awb IS NOT NULL RETURNING id::text AS id, duty_amount_idr, duty_decision`;
  if (!rows.length) return c.json({ error: { code: "NOT_FOUND", message: "Paket tidak ditemukan." }, meta: { requestId: c.get("requestId") } }, 404);
  await audit(sql, { actor: String(c.get("actor") ?? "api"), action: "paket.bea.update", resourceType: "supplier_sample", resourceId: id, requestId: c.get("requestId"), ok: true });
  const r = rows[0] as Record<string, any>;
  return ok(c, { id: r.id, duty_amount_idr: r.duty_amount_idr == null ? null : Number(r.duty_amount_idr), duty_decision: r.duty_decision });
});
