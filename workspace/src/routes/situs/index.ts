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
