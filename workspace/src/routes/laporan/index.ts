import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok } from "../../lib/http";
import { getSql } from "../../lib/db";

// Laporan mingguan (7 hari terakhir). HANYA MEMBACA.
export const laporanRoutes = new Hono<AppEnv>();

laporanRoutes.get("/mingguan", async (c) => {
  const sql = getSql(c.env);
  const r = (await sql`SELECT
    (SELECT count(*)::int FROM clinics WHERE archived = false AND created_at >= now() - interval '7 days') AS klinik_baru,
    (SELECT count(*)::int FROM clinic_activities WHERE type = 'whatsapp' AND summary <> 'Balasan WhatsApp masuk' AND occurred_at >= now() - interval '7 days') AS wa_keluar,
    (SELECT count(*)::int FROM clinic_activities WHERE type = 'whatsapp' AND summary = 'Balasan WhatsApp masuk' AND occurred_at >= now() - interval '7 days') AS wa_masuk,
    (SELECT count(*)::int FROM email_messages WHERE direction = 'inbound' AND received_at >= now() - interval '7 days') AS email_masuk,
    (SELECT count(*)::int FROM email_messages WHERE direction = 'outbound' AND received_at >= now() - interval '7 days') AS email_keluar,
    (SELECT count(*)::int FROM clinics WHERE archived = false AND stage = 'contacted') AS klinik_contacted,
    (SELECT count(*)::int FROM clinics WHERE archived = false AND stage = 'lead') AS klinik_lead,
    (SELECT count(*)::int FROM clinics WHERE archived = false AND stage NOT IN ('lead', 'contacted', 'inactive')) AS klinik_lanjut,
    (SELECT count(*)::int FROM catalog_orders WHERE created_at >= now() - interval '7 days') AS pesanan_baru,
    (SELECT count(*)::int FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id WHERE ss.state IN ('diminta','disepakati','dikirim','diuji') AND s.archived_at IS NULL AND s.name !~* '(liyin|yolanda)') AS sampel_berjalan`)[0] as Record<string, any>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r ?? {})) out[k] = Number(v);
  return ok(c, { periode_hari: 7, ...out, dibuat: new Date().toISOString() });
});
