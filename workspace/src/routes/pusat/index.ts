import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import type { AppEnv } from "../../lib/http";
import { ValidationError, ok, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";
import { readJsonObject } from "../../lib/body";
import { deteksi } from "../email/saran";

// Pusat Kerja: prioritas email, pelacak sampel, persetujuan, skor supplier, agenda, ringkasan pagi, ekspor.
export const pusatRoutes = new Hono<AppEnv>();
const SKIP = /(liyin|yolanda)/i;

pusatRoutes.get("/prioritas", async (c) => {
  const sql = getSql(c.env);
  const rows = await sql`SELECT t.id::text AS id, t.subject, t.metadata->'link'->>'name' AS supplier,
      lm.from_email, lm.at, lm.body, EXTRACT(DAY FROM now() - lm.at)::int AS hari
    FROM email_threads t
    JOIN LATERAL (SELECT m.direction, m.from_email, COALESCE(m.received_at, m.sent_at) AS at, left(m.body_text, 3000) AS body
      FROM email_messages m WHERE m.thread_id = t.id ORDER BY COALESCE(m.received_at, m.sent_at) DESC NULLS LAST, m.id DESC LIMIT 1) lm ON lm.direction = 'inbound'
    WHERE t.is_archived = false AND t.folder = 'inbox'
    ORDER BY lm.at ASC LIMIT 60`;
  const out = rows
    .filter((r: any) => !SKIP.test(String(r.supplier ?? "") + String(r.from_email ?? "") + String(r.subject ?? "")))
    .map((r: any) => {
      const flags = deteksi(String(r.body ?? ""));
      return { id: r.id, subject: r.subject, supplier: r.supplier, dari: r.from_email, hari: Number(r.hari ?? 0), flags,
        skor: flags.filter((f) => f.berat === "tinggi").length * 10 + Math.min(Number(r.hari ?? 0), 30) };
    })
    .sort((a, b) => b.skor - a.skor);
  return ok(c, out);
});

function lacak(courier: string | null, awb: string | null): string | null {
  if (!awb) return null;
  const k = (courier ?? "").toLowerCase();
  const n = encodeURIComponent(awb);
  if (k.includes("dhl")) return `https://www.dhl.com/id-en/home/tracking.html?tracking-id=${n}`;
  if (k.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (k.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  return `https://t.17track.net/en#nums=${n}`;
}

pusatRoutes.get("/sampel", async (c) => {
  const sql = getSql(c.env);
  const rows = await sql`SELECT ss.id::text AS id, s.name AS supplier, ss.description, ss.state, ss.awb, ss.courier, ss.eta::text AS eta,
      EXTRACT(DAY FROM now() - ss.updated_at)::int AS hari_diam, ss.duty_decision, ss.duty_amount_idr
    FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id
    WHERE s.archived_at IS NULL AND ss.state <> 'ditolak' ORDER BY ss.updated_at DESC LIMIT 100`;
  return ok(c, rows.filter((r: any) => !SKIP.test(String(r.supplier))).map((r: any) => ({
    ...r, hari_diam: Number(r.hari_diam ?? 0), duty_amount_idr: r.duty_amount_idr == null ? null : Number(r.duty_amount_idr),
    lacak: lacak(r.courier, r.awb), tertahan: r.state === "dikirim" && Number(r.hari_diam ?? 0) >= 10,
  })));
});

pusatRoutes.get("/persetujuan", async (c) => {
  const sql = getSql(c.env);
  const [bea, draf] = await Promise.all([
    sql`SELECT s.name AS supplier, ss.awb, ss.duty_amount_idr FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id WHERE ss.duty_decision = 'belum'`,
    sql`SELECT d.id::text AS id, d.subject, d.thread_id::text AS thread_id, d.status FROM email_drafts d WHERE d.status = 'needs_ok' ORDER BY d.updated_at DESC LIMIT 30`,
  ]);
  let pelanggan: any[] = [];
  if (c.env.KATALOG_DATABASE_URL) {
    try {
      pelanggan = await neon(c.env.KATALOG_DATABASE_URL)`SELECT id, name, clinic_name, email FROM customers WHERE status = 'pending' ORDER BY created_at DESC LIMIT 30`;
    } catch { /* situs tidak terjangkau */ }
  }
  return ok(c, {
    bea: bea.filter((r: any) => !SKIP.test(String(r.supplier))).map((r: any) => ({ ...r, duty_amount_idr: r.duty_amount_idr == null ? null : Number(r.duty_amount_idr) })),
    draf, pelanggan,
    total: bea.length + draf.length + pelanggan.length,
  });
});

export function skorSupplier(s: { status: string; hari: number | null; sampel: string[]; bea: string[] }) {
  let kom = 5; // komunikasi 30
  if (s.hari != null) kom = s.hari <= 7 ? 30 : s.hari <= 21 ? 20 : s.hari <= 45 ? 10 : 3;
  let smp = 10; // sampel 40
  if (s.sampel.some((x) => ["diuji", "lulus", "diterima"].includes(x))) smp = 40;
  else if (s.sampel.some((x) => x === "dikirim")) smp = 32;
  else if (s.sampel.some((x) => x === "disepakati")) smp = 25;
  else if (s.sampel.some((x) => x === "diminta")) smp = 18;
  if (s.bea.some((x) => x === "belum" || x === "bayar_disetujui")) smp = Math.min(smp, 8);
  const st = ({ sampel_berjalan: 30, menunggu_dokumen: 22, menunggu_izin: 22, kandidat: 18, menunggu_balasan: 15, menunggu_pembayaran: 8, hold: 0, ditutup: 0, ditolak_supplier: 0 } as Record<string, number>)[s.status] ?? 15; // tahap 30
  const skor = kom + smp + st;
  const label = s.status === "hold" ? "HOLD" : ["ditutup", "ditolak_supplier"].includes(s.status) || skor < 40 ? "EXIT" : skor >= 80 ? "GO" : skor >= 60 ? "NEGOTIATE" : "WAIT";
  return { skor, label, rincian: { komunikasi: kom, sampel: smp, tahap: st } };
}

pusatRoutes.get("/skor", async (c) => {
  const sql = getSql(c.env);
  const [sup, smp] = await Promise.all([
    sql`SELECT id::text AS id, name, country, status, EXTRACT(DAY FROM now() - last_activity_on::timestamp)::int AS hari FROM suppliers WHERE archived_at IS NULL`,
    sql`SELECT supplier_id::text AS sid, state, duty_decision FROM supplier_samples`,
  ]);
  const out = sup.filter((s: any) => !SKIP.test(String(s.name))).map((s: any) => {
    const mine = smp.filter((x: any) => x.sid === s.id);
    return { id: s.id, name: s.name, country: s.country, status: s.status,
      ...skorSupplier({ status: s.status, hari: s.hari == null ? null : Number(s.hari), sampel: mine.map((x: any) => x.state), bea: mine.map((x: any) => x.duty_decision) }) };
  }).sort((a: any, b: any) => b.skor - a.skor);
  return ok(c, { indikatif: true, catatan: "Skor indikatif dari data aplikasi (komunikasi, sampel, tahap). Bukan pengganti verifikasi dokumen.", items: out });
});

const JENIS = ["zoom", "kunjungan", "tenggat", "lainnya"];
pusatRoutes.get("/agenda", async (c) => {
  const sql = getSql(c.env);
  const [manual, eta, fu] = await Promise.all([
    sql`SELECT id::text AS id, judul, mulai, jenis, catatan FROM agenda WHERE mulai >= now() - interval '1 day' ORDER BY mulai LIMIT 100`,
    sql`SELECT s.name AS supplier, ss.eta::text AS eta, ss.description FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id WHERE ss.eta >= current_date - 1 AND ss.state IN ('dikirim','disepakati')`,
    sql`SELECT name, next_followup_at, next_followup_reason FROM clinics WHERE archived = false AND next_followup_at >= now() - interval '1 day' ORDER BY next_followup_at LIMIT 50`,
  ]);
  const items = [
    ...manual.map((m: any) => ({ id: m.id, judul: m.judul, mulai: m.mulai, jenis: m.jenis, catatan: m.catatan, manual: true })),
    ...eta.filter((e: any) => !SKIP.test(String(e.supplier))).map((e: any) => ({ judul: `ETA sampel ${e.supplier}`, mulai: e.eta + "T00:00:00+08:00", jenis: "sampel", catatan: e.description, manual: false })),
    ...fu.map((f: any) => ({ judul: `Follow-up ${f.name}`, mulai: f.next_followup_at, jenis: "klinik", catatan: f.next_followup_reason, manual: false })),
  ].sort((a, b) => new Date(a.mulai).getTime() - new Date(b.mulai).getTime());
  return ok(c, items);
});
pusatRoutes.post("/agenda", async (c) => {
  const b = await readJsonObject(c);
  const judul = typeof b.judul === "string" ? b.judul.trim() : "";
  const t = typeof b.mulai === "string" ? new Date(b.mulai) : null;
  if (!judul || judul.length > 200) throw new ValidationError("VALIDATION", "judul wajib (maks 200)");
  if (!t || Number.isNaN(t.getTime())) throw new ValidationError("VALIDATION", "mulai tidak valid");
  const jenis = typeof b.jenis === "string" && JENIS.includes(b.jenis) ? b.jenis : "lainnya";
  const catatan = typeof b.catatan === "string" ? b.catatan.slice(0, 1000) : null;
  const sql = getSql(c.env);
  const r = await sql`INSERT INTO agenda (judul, mulai, jenis, catatan) VALUES (${judul}, ${t.toISOString()}, ${jenis}, ${catatan}) RETURNING id::text AS id`;
  await audit(sql, { actor: String(c.get("actor") ?? "api"), action: "agenda.create", resourceType: "agenda", resourceId: r[0].id, requestId: c.get("requestId"), ok: true });
  return ok(c, r[0]);
});
pusatRoutes.delete("/agenda/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError("VALIDATION", "id tidak valid");
  const sql = getSql(c.env);
  const r = await sql`DELETE FROM agenda WHERE id = ${id} RETURNING id`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Agenda tidak ditemukan");
  await audit(sql, { actor: String(c.get("actor") ?? "api"), action: "agenda.delete", resourceType: "agenda", resourceId: String(id), requestId: c.get("requestId"), ok: true });
  return ok(c, { id });
});

async function ringkasan(c: any): Promise<{ subjek: string; teks: string }> {
  const sql = getSql(c.env);
  const [a] = await sql`SELECT
    (SELECT count(*)::int FROM clinics WHERE archived = false AND stage = 'lead') AS lead,
    (SELECT count(*)::int FROM clinics WHERE archived = false AND stage = 'contacted') AS contacted,
    (SELECT count(*)::int FROM email_threads t WHERE t.is_archived = false AND t.folder = 'inbox' AND t.is_read = false) AS belum_dibaca,
    (SELECT count(*)::int FROM supplier_samples WHERE duty_decision = 'belum') AS bea,
    (SELECT count(*)::int FROM email_drafts WHERE status = 'needs_ok') AS draf,
    (SELECT count(*)::int FROM clinic_activities WHERE type = 'whatsapp' AND summary <> 'Balasan WhatsApp masuk' AND occurred_at >= now() - interval '1 day') AS wa_kemarin`;
  const agenda = await sql`SELECT judul, to_char(mulai AT TIME ZONE 'Asia/Makassar', 'DD Mon HH24:MI') AS waktu FROM agenda WHERE mulai >= now() AND mulai < now() + interval '3 days' ORDER BY mulai LIMIT 5`;
  const tgl = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Makassar" });
  const baris = [
    `Ringkasan pagi AIL LABS - ${tgl}`, "",
    `Email belum dibaca: ${a.belum_dibaca}`, `Draf menunggu persetujuan: ${a.draf}`, `Bea menunggu keputusan: ${a.bea}`,
    `Klinik: ${a.lead} lead, ${a.contacted} sudah dihubungi`, `WhatsApp keluar 24 jam terakhir: ${a.wa_kemarin}`, "",
    agenda.length ? "Agenda 3 hari ke depan:" : "Tidak ada agenda 3 hari ke depan.",
    ...agenda.map((x: any) => `- ${x.waktu} ${x.judul}`),
  ];
  return { subjek: `Ringkasan pagi AIL LABS - ${tgl}`, teks: baris.join("\n") };
}
pusatRoutes.get("/ringkasan-pagi", async (c) => ok(c, await ringkasan(c)));
pusatRoutes.post("/ringkasan-pagi/kirim", async (c) => {
  const r = await ringkasan(c);
  if (c.env.EMAIL_SEND_MODE !== "live") return ok(c, { terkirim: false, alasan: "EMAIL_SEND_MODE bukan live (dry-run)", ...r });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Alexa | AIL LABS <alexa@inbox.ail-aesthetic-labs.my.id>", to: ["rady@ail-aesthetic-labs.my.id"], subject: r.subjek, text: r.teks }),
  });
  if (!res.ok) return fail(c, 503, "KIRIM_GAGAL", "Ringkasan belum bisa dikirim");
  return ok(c, { terkirim: true, ...r });
});

const q = (v: unknown) => { const s = v == null ? "" : String(v instanceof Date ? v.toISOString() : v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function csv(cols: string[], rows: Record<string, unknown>[]) {
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((k) => q(r[k])).join(","))].join("\r\n");
}
pusatRoutes.get("/ekspor/:jenis", async (c) => {
  const sql = getSql(c.env); const j = c.req.param("jenis");
  let cols: string[]; let rows: any[];
  if (j === "klinik") {
    cols = ["name", "city", "province", "stage", "interest", "pic_name", "phone", "email", "last_contact_at", "next_followup_at"];
    rows = await sql`SELECT name, city, province, stage, interest, pic_name, phone, email, last_contact_at, next_followup_at FROM clinics WHERE archived = false ORDER BY name`;
  } else if (j === "supplier") {
    cols = ["name", "country", "contact", "channel", "category", "status", "last_activity_on"];
    rows = (await sql`SELECT name, country, contact, channel, category, status, last_activity_on FROM suppliers WHERE archived_at IS NULL ORDER BY name`).filter((r: any) => !SKIP.test(String(r.name)));
  } else if (j === "sampel") {
    cols = ["supplier", "description", "state", "courier", "awb", "eta", "duty_amount_idr", "duty_decision"];
    rows = (await sql`SELECT s.name AS supplier, ss.description, ss.state, ss.courier, ss.awb, ss.eta, ss.duty_amount_idr, ss.duty_decision FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id ORDER BY s.name`).filter((r: any) => !SKIP.test(String(r.supplier)));
  } else if (j === "pesanan") {
    cols = ["created_at", "customer_name", "total", "status", "payment_method", "payment_status"];
    rows = await sql`SELECT created_at, customer_name, total, status, payment_method, payment_status FROM catalog_orders ORDER BY created_at DESC`;
  } else return fail(c, 404, "NOT_FOUND", "Jenis ekspor tidak dikenal");
  return new Response(csv(cols, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ail-${j}.csv"` } });
});
