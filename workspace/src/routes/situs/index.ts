import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import type { AppEnv } from "../../lib/http";
import { ValidationError, ok, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";
import { readJsonObject } from "../../lib/body";

// Kendali situs katalog (database Neon katalog). Butuh secret KATALOG_DATABASE_URL.
export const situsRoutes = new Hono<AppEnv>();

const CUST = ["incomplete", "pending", "approved", "rejected", "blocked"];
const RFQ = ["new", "contacted", "quoted", "won", "lost", "closed"];
const ORDER = ["baru", "diproses", "dikirim", "selesai", "batal"];

function kat(c: any) {
  const url = c.env.KATALOG_DATABASE_URL;
  if (!url) return null;
  return neon(url);
}
function id(c: any): number {
  const n = Number(c.req.param("id"));
  if (!Number.isInteger(n) || n < 1) throw new ValidationError("VALIDATION", "id tidak valid");
  return n;
}
async function log(c: any, action: string, rid: number) {
  await audit(getSql(c.env), { actor: String(c.get("actor") ?? "api"), action, resourceType: "situs", resourceId: String(rid), requestId: c.get("requestId"), ok: true });
}

situsRoutes.use("*", async (c, next) => {
  if (!c.env.KATALOG_DATABASE_URL) return fail(c, 503, "SITUS_BELUM_TERSAMBUNG", "KATALOG_DATABASE_URL belum dipasang");
  await next();
});

situsRoutes.get("/ringkasan", async (c) => {
  const sql = kat(c)!;
  const [r] = await sql`SELECT
    (SELECT count(*)::int FROM customers WHERE status = 'pending') AS pelanggan_menunggu,
    (SELECT count(*)::int FROM customers WHERE status = 'approved') AS pelanggan_aktif,
    (SELECT count(*)::int FROM products WHERE aktif) AS produk_aktif,
    (SELECT count(*)::int FROM orders WHERE status = 'baru') AS pesanan_baru,
    (SELECT count(*)::int FROM rfq_requests WHERE status = 'new') AS rfq_baru,
    (SELECT count(*)::int FROM lead_captures WHERE status = 'New') AS lead_baru,
    (SELECT count(*)::int FROM page_views WHERE timestamp >= now() - interval '7 days') AS tayang_7h,
    (SELECT count(DISTINCT session_id)::int FROM page_views WHERE timestamp >= now() - interval '7 days') AS pengunjung_7h`;
  return ok(c, r);
});

situsRoutes.get("/pelanggan", async (c) => {
  const st = c.req.query("status") ?? "";
  if (st && !CUST.includes(st)) throw new ValidationError("VALIDATION", "status tidak valid");
  const sql = kat(c)!;
  const rows = await sql`SELECT id, name, email, phone, clinic_name, status, customer_type, created_at, approved_at
    FROM customers WHERE (${st} = '' OR status = ${st}) ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200`;
  return ok(c, rows);
});
situsRoutes.patch("/pelanggan/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  if (typeof b.status !== "string" || !CUST.includes(b.status)) throw new ValidationError("VALIDATION", "status tidak valid");
  const sql = kat(c)!;
  const r = await sql`UPDATE customers SET status = ${b.status},
    approved_at = CASE WHEN ${b.status} = 'approved' THEN now() ELSE approved_at END,
    approved_by = CASE WHEN ${b.status} = 'approved' THEN 'workspace' ELSE approved_by END
    WHERE id = ${pid} RETURNING id, status`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Pelanggan tidak ditemukan");
  await log(c, "situs.pelanggan.status", pid);
  return ok(c, r[0]);
});

situsRoutes.get("/produk", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const sql = kat(c)!;
  const rows = await sql`SELECT id, name, kandungan, kemasan, harga, aktif, sort_order, foto_url, manfaat, category_id
    FROM products WHERE (${q} = '' OR name ILIKE ${"%" + q.replace(/[%_]/g, "") + "%"}) ORDER BY aktif DESC, sort_order, name LIMIT 150`;
  return ok(c, rows);
});
situsRoutes.patch("/produk/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  const sql = kat(c)!;
  const s = (k: string, max: number) => (typeof b[k] === "string" ? String(b[k]).slice(0, max) : null);
  const aktif = typeof b.aktif === "boolean" ? b.aktif : null;
  let harga: number | null = null;
  if (b.harga !== undefined) {
    if (!Number.isInteger(b.harga) || (b.harga as number) < 0) throw new ValidationError("VALIDATION", "harga harus bilangan bulat ≥ 0");
    harga = b.harga as number;
  }
  const r = await sql`UPDATE products SET
    aktif = COALESCE(${aktif}::boolean, aktif), harga = COALESCE(${harga}::int, harga),
    kandungan = COALESCE(${s("kandungan", 500)}, kandungan), kemasan = COALESCE(${s("kemasan", 200)}, kemasan),
    manfaat = COALESCE(${s("manfaat", 1000)}, manfaat), updated_at = now()
    WHERE id = ${pid} RETURNING id, name, aktif, harga`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Produk tidak ditemukan");
  await log(c, "situs.produk.update", pid);
  return ok(c, r[0]);
});

situsRoutes.get("/rfq", async (c) => {
  const sql = kat(c)!;
  const rows = await sql`SELECT id, created_at, name, company, whatsapp, email, customer_category, product, qty, notes, status
    FROM rfq_requests ORDER BY (status = 'new') DESC, created_at DESC LIMIT 100`;
  return ok(c, rows);
});
situsRoutes.patch("/rfq/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  if (typeof b.status !== "string" || !RFQ.includes(b.status)) throw new ValidationError("VALIDATION", "status tidak valid");
  const sql = kat(c)!;
  const r = await sql`UPDATE rfq_requests SET status = ${b.status}, updated_at = now() WHERE id = ${pid} RETURNING id, status`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "RFQ tidak ditemukan");
  await log(c, "situs.rfq.status", pid);
  return ok(c, r[0]);
});

situsRoutes.get("/pesanan", async (c) => {
  const sql = kat(c)!;
  const rows = await sql`SELECT id, created_at, customer_name, total, status, payment_method, payment_status, items
    FROM orders ORDER BY (status = 'baru') DESC, created_at DESC LIMIT 100`;
  return ok(c, rows);
});
situsRoutes.patch("/pesanan/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  if (typeof b.status !== "string" || !ORDER.includes(b.status)) throw new ValidationError("VALIDATION", "status tidak valid");
  const sql = kat(c)!;
  const r = await sql`UPDATE orders SET status = ${b.status} WHERE id = ${pid} RETURNING id, status`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Pesanan tidak ditemukan");
  await log(c, "situs.pesanan.status", pid);
  return ok(c, r[0]);
});

situsRoutes.get("/promo", async (c) => { const sql = kat(c)!; return ok(c, await sql`SELECT id, title, message, discount_text, active, start_date, end_date FROM promos ORDER BY created_at DESC LIMIT 50`); });
situsRoutes.patch("/promo/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  if (typeof b.active !== "boolean") throw new ValidationError("VALIDATION", "active harus boolean");
  const sql = kat(c)!;
  const r = await sql`UPDATE promos SET active = ${b.active} WHERE id = ${pid} RETURNING id, active`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Promo tidak ditemukan");
  await log(c, "situs.promo.update", pid);
  return ok(c, r[0]);
});

situsRoutes.get("/broadcast", async (c) => {
  const sql = kat(c)!;
  return ok(c, await sql`SELECT id, left(pesan, 160) AS pesan, tipe, status, per_hari, jeda_detik, dibuat_at, selesai_at FROM broadcast_campaigns ORDER BY dibuat_at DESC LIMIT 50`);
});

situsRoutes.get("/analitik", async (c) => {
  const sql = kat(c)!;
  const [harian, halaman, lead] = await Promise.all([
    sql`SELECT to_char(date_trunc('day', timestamp AT TIME ZONE 'Asia/Makassar'), 'YYYY-MM-DD') AS hari, count(*)::int AS tayang, count(DISTINCT session_id)::int AS pengunjung
      FROM page_views WHERE timestamp >= now() - interval '14 days' GROUP BY 1 ORDER BY 1`,
    sql`SELECT page_path, count(*)::int AS tayang FROM page_views WHERE timestamp >= now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    sql`SELECT id, created_at, name, company, phone, business_type, interest_category, lead_score, status FROM lead_captures ORDER BY created_at DESC LIMIT 10`,
  ]);
  return ok(c, { harian, halaman, lead });
});

// ───────── Tahap 2: kategori, leads, catatan/follow-up, pengaturan, pengunjung, jadwal ─────────
const LEAD = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];
const SUMBER = ["lead", "rfq", "pelanggan"];
const FU = ["baru", "dihubungi", "menunggu", "selesai"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max) : "");
function tglIso(v: unknown, wajib = false): string | null {
  if (v === undefined || v === null || v === "") { if (wajib) throw new ValidationError("VALIDATION", "tanggal wajib diisi"); return null; }
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ValidationError("VALIDATION", "tanggal tidak valid");
  return d.toISOString();
}

// Kategori
situsRoutes.get("/kategori", async (c) => {
  const sql = kat(c)!;
  const [grup, kategori] = await Promise.all([
    sql`SELECT id, name, sort_order FROM category_groups ORDER BY sort_order, name`,
    sql`SELECT c.id, c.name, c.sort_order, c.group_id, (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS jumlah_produk
      FROM categories c ORDER BY c.group_id NULLS LAST, c.sort_order, c.name`,
  ]);
  return ok(c, { grup, kategori });
});
situsRoutes.post("/kategori", async (c) => {
  const b = await readJsonObject(c);
  const name = str(b.name, 80);
  if (!name) throw new ValidationError("VALIDATION", "nama kategori wajib diisi");
  const so = b.sort_order === undefined ? 0 : Number(b.sort_order);
  if (!Number.isInteger(so)) throw new ValidationError("VALIDATION", "urutan harus bilangan bulat");
  const gid = b.group_id === undefined || b.group_id === null ? null : Number(b.group_id);
  if (gid !== null && !Number.isInteger(gid)) throw new ValidationError("VALIDATION", "group_id tidak valid");
  const sql = kat(c)!;
  try {
    const r = await sql`INSERT INTO categories (name, sort_order, group_id) VALUES (${name}, ${so}, ${gid}) RETURNING id, name, sort_order, group_id`;
    await log(c, "situs.kategori.tambah", r[0].id);
    return ok(c, r[0]);
  } catch (e: any) {
    if (e?.code === "23505") return fail(c, 409, "DUPLIKAT", "Kategori sudah ada");
    throw e;
  }
});
situsRoutes.patch("/kategori/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  const name = b.name === undefined ? null : str(b.name, 80);
  if (name !== null && !name) throw new ValidationError("VALIDATION", "nama tidak boleh kosong");
  const so = b.sort_order === undefined ? null : Number(b.sort_order);
  if (so !== null && !Number.isInteger(so)) throw new ValidationError("VALIDATION", "urutan harus bilangan bulat");
  const sql = kat(c)!;
  const r = await sql`UPDATE categories SET name = COALESCE(${name}, name), sort_order = COALESCE(${so}::int, sort_order) WHERE id = ${pid} RETURNING id, name, sort_order, group_id`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Kategori tidak ditemukan");
  await log(c, "situs.kategori.ubah", pid);
  return ok(c, r[0]);
});
situsRoutes.delete("/kategori/:id", async (c) => {
  const pid = id(c); const sql = kat(c)!;
  const [n] = await sql`SELECT count(*)::int AS n FROM products WHERE category_id = ${pid}`;
  if (n.n > 0) return fail(c, 409, "MASIH_DIPAKAI", `Kategori masih dipakai ${n.n} produk; pindahkan dulu`);
  const r = await sql`DELETE FROM categories WHERE id = ${pid} RETURNING id`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Kategori tidak ditemukan");
  await log(c, "situs.kategori.hapus", pid);
  return ok(c, { id: pid });
});

// Leads
situsRoutes.get("/leads", async (c) => {
  const st = c.req.query("status") ?? "";
  if (st && !LEAD.includes(st)) throw new ValidationError("VALIDATION", "status tidak valid");
  const sql = kat(c)!;
  const rows = await sql`SELECT l.id, l.created_at, l.name, l.company, l.phone, l.email, l.business_type, l.interest_category, l.lead_score, l.status, l.city, l.region, l.lead_source, l.notes,
      f.status AS fu_status, f.next_followup_at
    FROM lead_captures l LEFT JOIN contact_followups f ON f.source = 'lead' AND f.source_id = l.id
    WHERE (${st} = '' OR l.status = ${st}) ORDER BY l.lead_score DESC, l.created_at DESC LIMIT 200`;
  return ok(c, rows);
});
situsRoutes.patch("/leads/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  if (typeof b.status !== "string" || !LEAD.includes(b.status)) throw new ValidationError("VALIDATION", "status tidak valid");
  const sql = kat(c)!;
  const r = await sql`UPDATE lead_captures SET status = ${b.status}, last_activity_at = now() WHERE id = ${pid} RETURNING id, status`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Lead tidak ditemukan");
  await log(c, "situs.lead.status", pid);
  return ok(c, r[0]);
});

// Catatan & follow-up (lead / rfq / pelanggan)
situsRoutes.get("/catatan", async (c) => {
  const source = c.req.query("source") ?? ""; const sid = Number(c.req.query("source_id"));
  if (!SUMBER.includes(source) || !Number.isInteger(sid) || sid < 1) throw new ValidationError("VALIDATION", "source/source_id tidak valid");
  const sql = kat(c)!;
  const [catatan, fu] = await Promise.all([
    sql`SELECT id, note, created_by, created_at FROM contact_notes WHERE source = ${source} AND source_id = ${sid} ORDER BY created_at DESC LIMIT 50`,
    sql`SELECT status, last_contacted_at, next_followup_at FROM contact_followups WHERE source = ${source} AND source_id = ${sid}`,
  ]);
  return ok(c, { catatan, followup: fu[0] ?? null });
});
situsRoutes.post("/catatan", async (c) => {
  const b = await readJsonObject(c);
  const source = str(b.source, 20); const sid = Number(b.source_id); const note = str(b.note, 2000);
  if (!SUMBER.includes(source) || !Number.isInteger(sid) || sid < 1) throw new ValidationError("VALIDATION", "source/source_id tidak valid");
  if (!note) throw new ValidationError("VALIDATION", "catatan wajib diisi");
  const sql = kat(c)!;
  const r = await sql`INSERT INTO contact_notes (source, source_id, note, created_by) VALUES (${source}, ${sid}, ${note}, 'workspace') RETURNING id, note, created_at`;
  await log(c, "situs.catatan.tambah", sid);
  return ok(c, r[0]);
});
situsRoutes.put("/followup", async (c) => {
  const b = await readJsonObject(c);
  const source = str(b.source, 20); const sid = Number(b.source_id);
  if (!SUMBER.includes(source) || !Number.isInteger(sid) || sid < 1) throw new ValidationError("VALIDATION", "source/source_id tidak valid");
  const status = typeof b.status === "string" ? b.status : "baru";
  if (!FU.includes(status)) throw new ValidationError("VALIDATION", "status follow-up tidak valid");
  const next = tglIso(b.next_followup_at);
  const sql = kat(c)!;
  const r = await sql`INSERT INTO contact_followups (source, source_id, status, next_followup_at, last_contacted_at, updated_by, updated_at)
    VALUES (${source}, ${sid}, ${status}, ${next}, CASE WHEN ${status} = 'dihubungi' THEN now() ELSE NULL END, 'workspace', now())
    ON CONFLICT (source, source_id) DO UPDATE SET status = EXCLUDED.status, next_followup_at = EXCLUDED.next_followup_at,
      last_contacted_at = CASE WHEN EXCLUDED.status = 'dihubungi' THEN now() ELSE contact_followups.last_contacted_at END,
      updated_by = 'workspace', updated_at = now()
    RETURNING source, source_id, status, next_followup_at, last_contacted_at`;
  await log(c, "situs.followup.simpan", sid);
  return ok(c, r[0]);
});
situsRoutes.get("/followup", async (c) => {
  const sql = kat(c)!;
  return ok(c, await sql`SELECT source, source_id, status, next_followup_at, last_contacted_at FROM contact_followups
    WHERE status <> 'selesai' ORDER BY next_followup_at NULLS LAST LIMIT 100`);
});

// Pengaturan popup promo
const POPUP_DEFAULT = { active: false, badge: "Promo Spesial", title: "", subtitle: "", discount: "", note: "", whatsapp_number: "", whatsapp_message: "", reappear_hours: 24 };
situsRoutes.get("/pengaturan", async (c) => {
  const sql = kat(c)!;
  const r = await sql`SELECT value, updated_at FROM settings WHERE key = 'promo_popup'`;
  return ok(c, { promo_popup: { ...POPUP_DEFAULT, ...(r[0]?.value ?? {}) }, diubah: r[0]?.updated_at ?? null });
});
situsRoutes.put("/pengaturan/promo-popup", async (c) => {
  const b = await readJsonObject(c);
  if (typeof b.active !== "boolean") throw new ValidationError("VALIDATION", "active harus boolean");
  const jam = b.reappear_hours === undefined ? 24 : Number(b.reappear_hours);
  if (!Number.isInteger(jam) || jam < 0 || jam > 720) throw new ValidationError("VALIDATION", "reappear_hours 0–720");
  const wa = str(b.whatsapp_number, 20).replace(/[^0-9]/g, "");
  const value = {
    active: b.active, badge: str(b.badge, 40), title: str(b.title, 120), subtitle: str(b.subtitle, 300), discount: str(b.discount, 40),
    note: str(b.note, 200), whatsapp_number: wa, whatsapp_message: str(b.whatsapp_message, 200), reappear_hours: jam,
  };
  const sql = kat(c)!;
  await sql`INSERT INTO settings (key, value, updated_at) VALUES ('promo_popup', ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  await log(c, "situs.pengaturan.popup", 0);
  return ok(c, value);
});

// Pengunjung
situsRoutes.get("/pengunjung", async (c) => {
  const sql = kat(c)!;
  const [[ringkas], terbaru, jam] = await Promise.all([
    sql`SELECT (SELECT count(*)::int FROM visitors WHERE is_active AND last_activity >= now() - interval '5 minutes') AS aktif_sekarang,
      (SELECT count(DISTINCT session_id)::int FROM visitors WHERE entry_time >= date_trunc('day', now() AT TIME ZONE 'Asia/Makassar') AT TIME ZONE 'Asia/Makassar') AS hari_ini`,
    sql`SELECT session_id, page_visited, referrer, entry_time, last_activity, duration_ms, is_active FROM visitors ORDER BY last_activity DESC LIMIT 20`,
    sql`SELECT to_char(date_trunc('hour', timestamp AT TIME ZONE 'Asia/Makassar'), 'DD HH24:00') AS jam, count(*)::int AS tayang
      FROM page_views WHERE timestamp >= now() - interval '24 hours' GROUP BY 1 ORDER BY 1`,
  ]);
  return ok(c, { ...ringkas, terbaru, jam });
});

// Jadwal broadcast
situsRoutes.get("/jadwal-broadcast", async (c) => {
  const sql = kat(c)!;
  return ok(c, await sql`SELECT id, nama_jadwal, left(pesan_template, 160) AS pesan, pesan_per_hari, jam_mulai, jam_selesai, aktif, terakhir_kirim_at FROM broadcast_jadwal ORDER BY aktif DESC, id DESC LIMIT 50`);
});
situsRoutes.patch("/jadwal-broadcast/:id", async (c) => {
  const pid = id(c); const b = await readJsonObject(c);
  if (typeof b.aktif !== "boolean") throw new ValidationError("VALIDATION", "aktif harus boolean");
  const sql = kat(c)!;
  const r = await sql`UPDATE broadcast_jadwal SET aktif = ${b.aktif} WHERE id = ${pid} RETURNING id, aktif`;
  if (!r.length) return fail(c, 404, "NOT_FOUND", "Jadwal tidak ditemukan");
  await log(c, "situs.jadwal.ubah", pid);
  return ok(c, r[0]);
});
