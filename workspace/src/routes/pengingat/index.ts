import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError, ok } from "../../lib/http";
import { getSql } from "../../lib/db";
import { clampInt } from "../../lib/validate";

// Pengingat gabungan. HANYA MEMBACA: tidak ada penulisan, audit, atau panggilan eksternal.
export const pengingatRoutes = new Hono<AppEnv>();

type Sev = "tinggi" | "sedang" | "info";
type Item = { kind: string; ref_id: string; title: string; detail: string | null; due_at: string | null; severity: Sev };
const RANK: Record<Sev, number> = { tinggi: 0, sedang: 1, info: 2 };
const PER_KIND = 100;

const iso = (v: unknown) => { if (v == null) return null; const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const dstr = (v: unknown) => { if (v == null) return null; if (typeof v === "string") return v.slice(0, 10); const d = v as Date; const z = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`; };

pengingatRoutes.get("/", async (c) => {
  const q = c.req.query();
  const unknown = Object.keys(q).filter((k) => k !== "limit");
  if (unknown.length) throw new ValidationError("BAD_REQUEST", "Parameter tidak dikenal.", { fields: Object.fromEntries(unknown.map((k) => [k, "Parameter tidak dikenal."])) });
  const limit = clampInt(q.limit, 1, 100, 50);
  const sql = getSql(c.env);

  const [klinik, lewat, habis, sampel, pesanan, kampanye, counts, email, keputusan] = await Promise.all([
    sql`SELECT id, name, next_followup_reason AS reason, next_followup_at AS at, (now() - next_followup_at > interval '3 days') AS high
        FROM clinics WHERE archived = false AND next_followup_at IS NOT NULL AND next_followup_at <= now()
        ORDER BY next_followup_at ASC LIMIT ${PER_KIND}`,
    sql`SELECT id, subject_ref, doc_type, due_on FROM compliance_items
        WHERE due_on IS NOT NULL AND due_on < (now() AT TIME ZONE 'Asia/Makassar')::date AND status NOT IN ('diterima','diverifikasi')
          AND LOWER(subject_ref) NOT LIKE '%liyin%' AND LOWER(subject_ref) NOT LIKE '%yolanda%'
        ORDER BY due_on ASC LIMIT ${PER_KIND}`,
    sql`SELECT id, subject_ref, doc_type, expires_on FROM compliance_items
        WHERE expires_on IS NOT NULL AND expires_on >= (now() AT TIME ZONE 'Asia/Makassar')::date AND expires_on <= (now() AT TIME ZONE 'Asia/Makassar')::date + 30
          AND LOWER(subject_ref) NOT LIKE '%liyin%' AND LOWER(subject_ref) NOT LIKE '%yolanda%'
        ORDER BY expires_on ASC LIMIT ${PER_KIND}`,
    sql`SELECT ss.id, s.name AS supplier, ss.description, ss.eta
        FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id
        WHERE ss.eta IS NOT NULL AND ss.eta < (now() AT TIME ZONE 'Asia/Makassar')::date AND ss.state IN ('diminta','disepakati','dikirim')
          AND s.archived_at IS NULL AND LOWER(s.slug) NOT LIKE 'liyin%' AND s.name NOT ILIKE '%liyin%' AND s.name NOT ILIKE '%yolanda%'
        ORDER BY ss.eta ASC LIMIT ${PER_KIND}`,
    sql`SELECT id, customer_name, created_at FROM catalog_orders
        WHERE status = 'baru' AND created_at < now() - interval '2 days'
        ORDER BY created_at ASC LIMIT ${PER_KIND}`,
    sql`SELECT id, name, scheduled_at FROM campaigns
        WHERE status = 'dijadwalkan' AND scheduled_at IS NOT NULL AND scheduled_at >= now() AND scheduled_at <= now() + interval '24 hours'
        ORDER BY scheduled_at ASC LIMIT ${PER_KIND}`,
    sql`SELECT
        (SELECT count(*)::int FROM clinics WHERE archived = false AND next_followup_at IS NOT NULL AND next_followup_at <= now()) AS klinik_tindak_lanjut,
        (SELECT count(*)::int FROM compliance_items WHERE due_on IS NOT NULL AND due_on < (now() AT TIME ZONE 'Asia/Makassar')::date AND status NOT IN ('diterima','diverifikasi') AND LOWER(subject_ref) NOT LIKE '%liyin%' AND LOWER(subject_ref) NOT LIKE '%yolanda%') AS kepatuhan_lewat,
        (SELECT count(*)::int FROM compliance_items WHERE expires_on IS NOT NULL AND expires_on >= (now() AT TIME ZONE 'Asia/Makassar')::date AND expires_on <= (now() AT TIME ZONE 'Asia/Makassar')::date + 30 AND LOWER(subject_ref) NOT LIKE '%liyin%' AND LOWER(subject_ref) NOT LIKE '%yolanda%') AS kepatuhan_habis,
        (SELECT count(*)::int FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id WHERE ss.eta IS NOT NULL AND ss.eta < (now() AT TIME ZONE 'Asia/Makassar')::date AND ss.state IN ('diminta','disepakati','dikirim') AND s.archived_at IS NULL AND LOWER(s.slug) NOT LIKE 'liyin%' AND s.name NOT ILIKE '%liyin%' AND s.name NOT ILIKE '%yolanda%') AS sampel_telat,
        (SELECT count(*)::int FROM catalog_orders WHERE status = 'baru' AND created_at < now() - interval '2 days') AS pesanan_baru,
        (SELECT count(*)::int FROM campaigns WHERE status = 'dijadwalkan' AND scheduled_at IS NOT NULL AND scheduled_at >= now() AND scheduled_at <= now() + interval '24 hours') AS kampanye_jadwal,
        (SELECT count(*)::int FROM email_threads t JOIN LATERAL (SELECT direction, from_email FROM email_messages m WHERE m.thread_id = t.id ORDER BY m.received_at DESC, m.id DESC LIMIT 1) lm ON true
          WHERE t.metadata ? 'link' AND lm.direction = 'inbound' AND lower(lm.from_email) NOT IN ('radyp13@gmail.com', 'rady@ail-aesthetic-labs.my.id')
            AND t.last_message_at >= now() - interval '14 days' AND LOWER(t.subject) NOT LIKE '%liyin%' AND LOWER(COALESCE(t.metadata->'link'->>'name', '')) !~ '(liyin|yolanda)') AS email_belum_dibalas,
        (SELECT count(*)::int FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id WHERE ss.state IN ('disepakati', 'diuji') AND s.archived_at IS NULL AND s.name !~* '(liyin|yolanda)') AS sampel_keputusan`,
    sql`SELECT t.id, t.subject, t.last_message_at AS at, t.metadata->'link'->>'name' AS who, t.metadata->'link'->>'kind' AS lk
        FROM email_threads t JOIN LATERAL (SELECT direction, from_email FROM email_messages m WHERE m.thread_id = t.id ORDER BY m.received_at DESC, m.id DESC LIMIT 1) lm ON true
        WHERE t.metadata ? 'link' AND lm.direction = 'inbound' AND lower(lm.from_email) NOT IN ('radyp13@gmail.com', 'rady@ail-aesthetic-labs.my.id')
          AND t.last_message_at >= now() - interval '14 days' AND LOWER(t.subject) NOT LIKE '%liyin%' AND LOWER(COALESCE(t.metadata->'link'->>'name', '')) !~ '(liyin|yolanda)'
        ORDER BY t.last_message_at DESC LIMIT ${PER_KIND}`,
    sql`SELECT ss.id, s.name AS supplier, ss.description, ss.state, s.last_activity_on AS at
        FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id
        WHERE ss.state IN ('disepakati', 'diuji') AND s.archived_at IS NULL AND s.name !~* '(liyin|yolanda)'
        ORDER BY s.last_activity_on DESC NULLS LAST LIMIT ${PER_KIND}`,
  ]);

  const items: Item[] = [
    ...klinik.map((r: Record<string, any>): Item => ({ kind: "klinik_tindak_lanjut", ref_id: String(r.id), title: r.name, detail: r.reason ?? null, due_at: iso(r.at), severity: r.high ? "tinggi" : "sedang" })),
    ...lewat.map((r: Record<string, any>): Item => ({ kind: "kepatuhan_lewat", ref_id: String(r.id), title: `${r.doc_type} · ${r.subject_ref}`, detail: null, due_at: dstr(r.due_on), severity: "tinggi" })),
    ...habis.map((r: Record<string, any>): Item => ({ kind: "kepatuhan_habis", ref_id: String(r.id), title: `${r.doc_type} · ${r.subject_ref}`, detail: null, due_at: dstr(r.expires_on), severity: "sedang" })),
    ...sampel.map((r: Record<string, any>): Item => ({ kind: "sampel_telat", ref_id: String(r.id), title: r.supplier, detail: r.description ?? null, due_at: dstr(r.eta), severity: "sedang" })),
    ...pesanan.map((r: Record<string, any>): Item => ({ kind: "pesanan_baru", ref_id: String(r.id), title: `Pesanan ${r.customer_name}`, detail: null, due_at: iso(r.created_at), severity: "sedang" })),
    ...email.map((r: Record<string, any>): Item => ({ kind: "email_belum_dibalas", ref_id: String(r.id), title: `${r.who ?? "Pengirim"} · ${r.subject ?? "(tanpa subjek)"}`, detail: r.lk === "clinic" ? "Klinik" : "Supplier", due_at: iso(r.at), severity: "sedang" })),
    ...keputusan.map((r: Record<string, any>): Item => ({ kind: "sampel_keputusan", ref_id: String(r.id), title: r.supplier, detail: `${r.description ?? ""} (${r.state})`.trim(), due_at: dstr(r.at), severity: "sedang" })),
    ...kampanye.map((r: Record<string, any>): Item => ({ kind: "kampanye_jadwal", ref_id: String(r.id), title: r.name, detail: null, due_at: iso(r.scheduled_at), severity: "info" })),
  ];
  items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));

  const cnt = (counts[0] ?? {}) as Record<string, number>;
  const countsOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(cnt)) countsOut[k] = Number(v);
  const total = Object.values(countsOut).reduce((a, b) => a + b, 0);
  return ok(c, { items: items.slice(0, limit), counts: countsOut, total });
});
