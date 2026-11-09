import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError, fail, ok } from "../../lib/http";
import { getSql } from "../../lib/db";
import { audit } from "../../lib/audit";
import { readJsonObject } from "../../lib/body";
import { isUuid, clampInt } from "../../lib/validate";

export const katalogRoutes = new Hono<AppEnv>();

export const ORDER_STATUSES = ["baru", "diproses", "dikirim", "selesai", "batal"] as const;

function bad(message: string, fields?: Record<string, string>): never {
  throw new ValidationError("BAD_REQUEST", message, fields ? { fields } : undefined);
}
function esc(v: string) { return v.replace(/[\\%_]/g, "\\$&"); }
function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const productOut = (r: Record<string, any>) => ({
  ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at),
});
const orderOut = (r: Record<string, any>) => ({
  ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at),
});

katalogRoutes.get("/categories", async (c) => {
  const sql = getSql(c.env);
  const rows = await sql`SELECT cat.id, cat.name, cat.group_name, cat.sort_order,
      count(p.id)::int AS product_count,
      count(p.id) FILTER (WHERE p.aktif)::int AS active_count
    FROM catalog_categories cat
    LEFT JOIN catalog_products p ON p.category_id = cat.id
    GROUP BY cat.id ORDER BY cat.group_name NULLS LAST, cat.sort_order, cat.name`;
  return ok(c, rows);
});

katalogRoutes.get("/products", async (c) => {
  const q = c.req.query();
  const allowed = new Set(["q", "category_id", "aktif", "limit", "page"]);
  const unknown = Object.keys(q).filter((k) => !allowed.has(k));
  if (unknown.length) bad("Parameter tidak dikenal.", Object.fromEntries(unknown.map((k) => [k, "Parameter tidak dikenal."])));
  const search = q.q?.trim() || null;
  const pattern = search ? `%${esc(search)}%` : null;
  const category = q.category_id || null;
  if (category && !isUuid(category)) bad("category_id tidak valid.");
  let aktif: boolean | null = null;
  if (q.aktif !== undefined && q.aktif !== "") {
    if (q.aktif !== "true" && q.aktif !== "false") bad("Filter aktif tidak valid.");
    aktif = q.aktif === "true";
  }
  const limit = clampInt(q.limit, 1, 500, 100);
  const page = clampInt(q.page, 1, 100000, 1);
  const sql = getSql(c.env);
  const [rows, count] = await Promise.all([
    sql`SELECT p.*, cat.name AS category_name FROM catalog_products p
      LEFT JOIN catalog_categories cat ON cat.id = p.category_id
      WHERE (${category}::uuid IS NULL OR p.category_id = ${category})
        AND (${aktif}::boolean IS NULL OR p.aktif = ${aktif})
        AND (${pattern}::text IS NULL OR p.name ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(p.kandungan,'') ILIKE ${pattern} ESCAPE '\\')
      ORDER BY cat.sort_order NULLS LAST, p.sort_order, p.name
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    sql`SELECT count(*)::int AS total FROM catalog_products p
      WHERE (${category}::uuid IS NULL OR p.category_id = ${category})
        AND (${aktif}::boolean IS NULL OR p.aktif = ${aktif})
        AND (${pattern}::text IS NULL OR p.name ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(p.kandungan,'') ILIKE ${pattern} ESCAPE '\\')`,
  ]);
  const total = Number(count[0]?.total ?? 0);
  return ok(c, rows.map(productOut), { page, limit, total, total_pages: Math.ceil(total / limit) });
});

const TEXT_FIELDS = ["name", "kandungan", "kemasan", "manfaat", "foto_url"] as const;
const PRICE_FIELDS = ["harga", "harga_asli"] as const;
const OTHER_FIELDS = ["aktif", "sort_order", "category_id"] as const;

katalogRoutes.patch("/products/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) bad("ID produk tidak valid.");
  const body = await readJsonObject(c);
  const allowed = new Set<string>([...TEXT_FIELDS, ...PRICE_FIELDS, ...OTHER_FIELDS]);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) bad("Field tidak dikenal.", Object.fromEntries(unknown.map((k) => [k, "Field tidak dikenal."])));
  if (!Object.keys(body).length) bad("Tidak ada perubahan.");

  const touchesPrice = PRICE_FIELDS.some((k) => k in body);
  if (touchesPrice && c.get("actor") !== "owner") {
    return fail(c, 403, "PRICE_OWNER_ONLY", "Harga hanya dapat diubah oleh pemilik.");
  }

  const fields: Record<string, string> = {};
  const set: Record<string, unknown> = {};
  for (const k of TEXT_FIELDS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === "name") {
      if (typeof v !== "string" || !v.trim() || v.trim().length > 200) fields[k] = "Nama wajib diisi (maks. 200 karakter).";
      else set[k] = v.trim();
    } else if (v === null || (typeof v === "string" && !v.trim())) set[k] = null;
    else if (typeof v !== "string" || v.length > 2000) fields[k] = "Teks tidak valid.";
    else set[k] = v.trim();
  }
  for (const k of PRICE_FIELDS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null) set[k] = null;
    else if (!Number.isInteger(v) || (v as number) < 0) fields[k] = "Harga harus bilangan bulat >= 0 atau null.";
    else set[k] = v;
  }
  if ("aktif" in body) { if (typeof body.aktif !== "boolean") fields.aktif = "Harus boolean."; else set.aktif = body.aktif; }
  if ("sort_order" in body) { if (!Number.isInteger(body.sort_order)) fields.sort_order = "Harus bilangan bulat."; else set.sort_order = body.sort_order; }
  if ("category_id" in body) {
    if (body.category_id !== null && !isUuid(body.category_id)) fields.category_id = "ID kategori tidak valid.";
    else set.category_id = body.category_id;
  }
  if (Object.keys(fields).length) throw new ValidationError("VALIDATION_ERROR", "Data produk tidak valid.", { fields });

  const cols = [...TEXT_FIELDS, ...PRICE_FIELDS, ...OTHER_FIELDS];
  const v = (k: string) => (k in set ? set[k] : null);
  const has = (k: string) => k in set;
  const sql = getSql(c.env);
  const rows = await sql`UPDATE catalog_products SET
      name = CASE WHEN ${has("name")} THEN ${v("name")} ELSE name END,
      kandungan = CASE WHEN ${has("kandungan")} THEN ${v("kandungan")} ELSE kandungan END,
      kemasan = CASE WHEN ${has("kemasan")} THEN ${v("kemasan")} ELSE kemasan END,
      manfaat = CASE WHEN ${has("manfaat")} THEN ${v("manfaat")} ELSE manfaat END,
      foto_url = CASE WHEN ${has("foto_url")} THEN ${v("foto_url")} ELSE foto_url END,
      harga = CASE WHEN ${has("harga")} THEN ${v("harga")}::int ELSE harga END,
      harga_asli = CASE WHEN ${has("harga_asli")} THEN ${v("harga_asli")}::int ELSE harga_asli END,
      aktif = CASE WHEN ${has("aktif")} THEN ${v("aktif")}::boolean ELSE aktif END,
      sort_order = CASE WHEN ${has("sort_order")} THEN ${v("sort_order")}::int ELSE sort_order END,
      category_id = CASE WHEN ${has("category_id")} THEN ${v("category_id")}::uuid ELSE category_id END,
      updated_at = now()
    WHERE id = ${id} RETURNING *`;
  void cols;
  if (!rows[0]) return fail(c, 404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");
  await audit(sql, {
    actor: c.get("actor") === "owner" ? "owner" : "access",
    action: touchesPrice ? "katalog.product.price" : "katalog.product.update",
    resourceType: "catalog_product", resourceId: id, requestId: c.get("requestId"), ok: true,
  });
  return ok(c, productOut(rows[0]));
});

katalogRoutes.get("/orders", async (c) => {
  const q = c.req.query();
  const unknown = Object.keys(q).filter((k) => !["status", "limit"].includes(k));
  if (unknown.length) bad("Parameter tidak dikenal.");
  const status = q.status || null;
  if (status && !(ORDER_STATUSES as readonly string[]).includes(status)) bad("Filter status tidak valid.");
  const limit = clampInt(q.limit, 1, 200, 100);
  const sql = getSql(c.env);
  const rows = await sql`SELECT * FROM catalog_orders
    WHERE (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC LIMIT ${limit}`;
  return ok(c, rows.map(orderOut));
});

katalogRoutes.patch("/orders/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) bad("ID pesanan tidak valid.");
  const body = await readJsonObject(c);
  const extra = Object.keys(body).filter((k) => k !== "status");
  if (extra.length) bad("Hanya status yang boleh diubah.", Object.fromEntries(extra.map((k) => [k, "Field tidak dikenal."])));
  if (typeof body.status !== "string" || !(ORDER_STATUSES as readonly string[]).includes(body.status)) {
    throw new ValidationError("VALIDATION_ERROR", "Status pesanan tidak valid.", { fields: { status: "Pilih salah satu status yang tersedia." } });
  }
  const sql = getSql(c.env);
  const rows = await sql`UPDATE catalog_orders SET status = ${body.status}, updated_at = now()
    WHERE id = ${id} RETURNING *`;
  if (!rows[0]) return fail(c, 404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");
  await audit(sql, {
    actor: c.get("actor") === "owner" ? "owner" : "access",
    action: "katalog.order.status", resourceType: "catalog_order", resourceId: id,
    requestId: c.get("requestId"), ok: true,
  });
  return ok(c, orderOut(rows[0]));
});

katalogRoutes.get("/summary", async (c) => {
  if (Object.keys(c.req.query()).length) bad("Endpoint summary tidak menerima parameter.");
  const sql = getSql(c.env);
  const [prod, orders] = await Promise.all([
    sql`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE aktif)::int AS active,
        count(*) FILTER (WHERE harga IS NULL)::int AS without_price
      FROM catalog_products`,
    sql`SELECT status, count(*)::int AS total FROM catalog_orders GROUP BY status ORDER BY status`,
  ]);
  return ok(c, {
    products: prod[0] ?? { total: 0, active: 0, without_price: 0 },
    orders_by_status: orders,
  });
});
