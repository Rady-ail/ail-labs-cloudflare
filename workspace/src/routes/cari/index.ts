import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError, ok } from "../../lib/http";
import { getSql } from "../../lib/db";
import { clampInt } from "../../lib/validate";

// Pencarian global. HANYA MEMBACA: tidak ada INSERT/UPDATE/DELETE, tidak ada audit, tidak ada panggilan eksternal.
export const cariRoutes = new Hono<AppEnv>();

function bad(message: string, fields?: Record<string, string>): never {
  throw new ValidationError("BAD_REQUEST", message, fields ? { fields } : undefined);
}
function invalid(message: string, fields: Record<string, string>): never {
  throw new ValidationError("VALIDATION_ERROR", message, { fields });
}
const esc = (v: string) => v.replace(/[\\%_]/g, "\\$&");
const join = (...p: Array<string | null | undefined>) => p.filter((x) => x && String(x).trim()).join(" · ") || null;

cariRoutes.get("/", async (c) => {
  const q = c.req.query();
  const unknown = Object.keys(q).filter((k) => !["q", "limit"].includes(k));
  if (unknown.length) bad("Parameter tidak dikenal.", Object.fromEntries(unknown.map((k) => [k, "Parameter tidak dikenal."])));
  const term = (q.q ?? "").trim();
  if (term.length < 2 || term.length > 60) invalid("Kata kunci tidak valid.", { q: "Gunakan 2–60 karakter." });
  const limit = clampInt(q.limit, 1, 10, 5);
  const p = `%${esc(term)}%`;
  const sql = getSql(c.env);

  const [clinics, suppliers, products, orders, compliance, campaigns] = await Promise.all([
    sql`SELECT id, name, city, province FROM clinics
        WHERE archived = false AND (name ILIKE ${p} ESCAPE '\\' OR city ILIKE ${p} ESCAPE '\\' OR province ILIKE ${p} ESCAPE '\\' OR pic_name ILIKE ${p} ESCAPE '\\')
        ORDER BY name ASC LIMIT ${limit}`,
    sql`SELECT id, name, country, category, status FROM suppliers
        WHERE archived_at IS NULL
          AND LOWER(slug) NOT LIKE 'liyin%' AND name NOT ILIKE '%liyin%' AND name NOT ILIKE '%yolanda%'
          AND (name ILIKE ${p} ESCAPE '\\' OR country ILIKE ${p} ESCAPE '\\' OR category ILIKE ${p} ESCAPE '\\')
        ORDER BY name ASC LIMIT ${limit}`,
    sql`SELECT id, name, kemasan FROM catalog_products
        WHERE name ILIKE ${p} ESCAPE '\\' OR kandungan ILIKE ${p} ESCAPE '\\'
        ORDER BY name ASC LIMIT ${limit}`,
    sql`SELECT id, customer_name, status FROM catalog_orders
        WHERE customer_name ILIKE ${p} ESCAPE '\\'
        ORDER BY created_at DESC LIMIT ${limit}`,
    sql`SELECT id, subject_ref, doc_type, status FROM compliance_items
        WHERE subject_ref ILIKE ${p} ESCAPE '\\'
          AND LOWER(subject_ref) NOT LIKE '%liyin%' AND LOWER(subject_ref) NOT LIKE '%yolanda%'
        ORDER BY subject_ref ASC, doc_type ASC LIMIT ${limit}`,
    sql`SELECT id, name, channel, status FROM campaigns
        WHERE name ILIKE ${p} ESCAPE '\\'
        ORDER BY created_at DESC LIMIT ${limit}`,
  ]);

  const out = {
    clinics: clinics.map((r: Record<string, any>) => ({ id: String(r.id), title: r.name, subtitle: join(r.city, r.province), route: "/crm" })),
    suppliers: suppliers.map((r: Record<string, any>) => ({ id: String(r.id), title: r.name, subtitle: join(r.country, r.category, r.status), route: "/supplier-dan-sampel" })),
    products: products.map((r: Record<string, any>) => ({ id: String(r.id), title: r.name, subtitle: join(r.kemasan), route: "/katalog-dan-pesanan" })),
    orders: orders.map((r: Record<string, any>) => ({ id: String(r.id), title: r.customer_name, subtitle: join("Pesanan", r.status), route: "/katalog-dan-pesanan" })),
    compliance: compliance.map((r: Record<string, any>) => ({ id: String(r.id), title: r.subject_ref, subtitle: join(r.doc_type, r.status), route: "/kepatuhan" })),
    campaigns: campaigns.map((r: Record<string, any>) => ({ id: String(r.id), title: r.name, subtitle: join(r.channel, r.status), route: "/kampanye" })),
  };
  const total = Object.values(out).reduce((n, a) => n + a.length, 0);
  return ok(c, { ...out, total });
});
