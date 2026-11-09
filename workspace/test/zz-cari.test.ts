import { describe, test, expect } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const H = { Authorization: "Bearer tok" };
const call = (p: string) => app.request(p, { headers: H }, env);

describe("cari (pencarian global, baca-saja)", () => {
  test("hasil, filter keamanan, validasi", async () => {
    const db = await getDb();
    await db.exec(`
      INSERT INTO clinics (name, city, province, stage, archived) VALUES
        ('Klinik Cariaura', 'Denpasar', 'Bali', 'lead', false),
        ('Klinik Cariarsip', 'Denpasar', 'Bali', 'lead', true);
      INSERT INTO suppliers (slug, name, country, category, status) VALUES
        ('cari-sup', 'Cari Supplier', 'China', 'skincare_oem', 'kandidat'),
        ('liyin-biotech-x', 'Liyin Biotech Cari', 'China', 'skincare_oem', 'kandidat');
      INSERT INTO catalog_products (name, kemasan, harga, aktif) VALUES ('Cari Produk', 'Box isi 10', 123456, true);
      INSERT INTO catalog_orders (customer_name, items, total, status) VALUES ('Cari Pembeli', '[]'::jsonb, 999, 'baru');
      INSERT INTO compliance_items (subject_type, subject_ref, doc_type) VALUES ('supplier', 'Cari Supplier', 'inci'), ('supplier', 'Liyin Biotech Cari', 'inci');
      INSERT INTO campaigns (name, channel, body) VALUES ('Kampanye Cari', 'whatsapp', 'Isi rahasia');
    `);
    const r = await call("/api/cari?q=cari");
    expect(r.status).toBe(200);
    const j: any = await r.json();
    const d = j.data;
    expect(d.clinics.map((x: any) => x.title)).toEqual(["Klinik Cariaura"]);
    expect(d.suppliers.map((x: any) => x.title)).toEqual(["Cari Supplier"]);
    expect(d.compliance.every((x: any) => !/liyin/i.test(x.title))).toBe(true);
    expect(d.products.length).toBe(1); expect(d.orders.length).toBe(1); expect(d.campaigns.length).toBe(1);
    expect(d.total).toBe(6);
    const raw = JSON.stringify(j);
    expect(raw).not.toContain("123456"); expect(raw).not.toContain("Isi rahasia"); expect(raw).not.toMatch(/liyin/i);
    expect(d.clinics[0].route).toBe("/crm");
    // limit
    const l: any = await (await call("/api/cari?q=cari&limit=1")).json(); expect(l.data.clinics.length).toBeLessThanOrEqual(1);
    // wildcard tidak cocok semua
    const w: any = await (await call("/api/cari?q=%25%25")).json(); expect(w.data.total).toBe(0);
    const u: any = await (await call("/api/cari?q=__")).json(); expect(u.data.total).toBe(0);
    // validasi
    const s = await call("/api/cari?q=a"); expect(s.status).toBe(422); expect(((await s.json()) as any).error.fields.q).toBeTruthy();
    expect((await call("/api/cari")).status).toBe(422);
    expect((await call("/api/cari?q=cari&foo=1")).status).toBe(400);
    expect((await call("/api/cari?q=" + "x".repeat(61))).status).toBe(422);
    expect((await app.request("/api/cari?q=cari", {}, env)).status).toBe(401);
    expect((await app.request("/api/cari?q=cari", { method: "POST", headers: H }, env)).status).toBeGreaterThanOrEqual(400);
  });
});
