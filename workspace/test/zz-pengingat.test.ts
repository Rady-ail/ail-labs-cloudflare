import { describe, test, expect } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const H = { Authorization: "Bearer tok" };
const call = (p: string) => app.request(p, { headers: H }, env);
const count = async (db: any) => (await db.query(`SELECT
  (SELECT count(*) FROM clinics)::int a, (SELECT count(*) FROM compliance_items)::int b, (SELECT count(*) FROM catalog_orders)::int c,
  (SELECT count(*) FROM campaigns)::int d, (SELECT count(*) FROM supplier_samples)::int e, (SELECT count(*) FROM audit_log)::int f`)).rows[0];

describe("pengingat (gabungan, baca-saja)", () => {
  test("tiap jenis, urutan, counts, tanpa perubahan data", async () => {
    const db = await getDb();
    await db.exec(`
      INSERT INTO clinics (name, city, province, stage, archived, next_followup_at, next_followup_reason) VALUES
        ('Klinik Telat Lama', 'Kota', 'Provinsi', 'lead', false, now() - interval '10 days', 'Kirim katalog'),
        ('Klinik Telat Baru', 'Kota', 'Provinsi', 'lead', false, now() - interval '1 hour', 'Cek minat'),
        ('Klinik Arsip Telat', 'Kota', 'Provinsi', 'lead', true, now() - interval '10 days', 'x'),
        ('Klinik Nanti', 'Kota', 'Provinsi', 'lead', false, now() + interval '5 days', 'x');
      INSERT INTO compliance_items (subject_type, subject_ref, doc_type, status, due_on, expires_on) VALUES
        ('supplier', 'Sup A', 'cfs', 'diminta', (now() AT TIME ZONE 'Asia/Makassar')::date - 3, NULL),
        ('supplier', 'Sup A', 'halal', 'diterima', (now() AT TIME ZONE 'Asia/Makassar')::date - 3, NULL),
        ('supplier', 'Sup A', 'inci', 'diterima', NULL, (now() AT TIME ZONE 'Asia/Makassar')::date + 10),
        ('supplier', 'Sup A', 'msds_sds', 'belum', NULL, (now() AT TIME ZONE 'Asia/Makassar')::date + 90),
        ('supplier', 'Liyin Biotech', 'cfs', 'belum', (now() AT TIME ZONE 'Asia/Makassar')::date - 3, NULL);
      INSERT INTO suppliers (slug, name, category, status) VALUES ('sup-sampel', 'Sup Sampel', 'skincare_oem', 'sampel_berjalan'), ('liyin-x', 'Liyin Biotech', 'skincare_oem', 'kandidat');
      INSERT INTO supplier_samples (supplier_id, description, state, eta)
        SELECT id, 'Sampel telat', 'dikirim', (now() AT TIME ZONE 'Asia/Makassar')::date - 2 FROM suppliers WHERE slug = 'sup-sampel';
      INSERT INTO supplier_samples (supplier_id, description, state, eta)
        SELECT id, 'Sampel sudah tiba', 'diterima', (now() AT TIME ZONE 'Asia/Makassar')::date - 2 FROM suppliers WHERE slug = 'sup-sampel';
      INSERT INTO supplier_samples (supplier_id, description, state, eta)
        SELECT id, 'Liyin', 'dikirim', (now() AT TIME ZONE 'Asia/Makassar')::date - 2 FROM suppliers WHERE slug = 'liyin-x';
      INSERT INTO catalog_orders (customer_name, items, total, status, created_at) VALUES
        ('Lama', '[]'::jsonb, 1, 'baru', now() - interval '5 days'),
        ('Baru saja', '[]'::jsonb, 1, 'baru', now()),
        ('Sudah selesai', '[]'::jsonb, 1, 'selesai', now() - interval '9 days');
      INSERT INTO campaigns (name, channel, body, status, scheduled_at) VALUES
        ('Besok', 'whatsapp', 'x', 'dijadwalkan', now() + interval '3 hours'),
        ('Jauh', 'whatsapp', 'x', 'dijadwalkan', now() + interval '5 days');
    `);
    const before = await count(db);
    const r = await call("/api/pengingat");
    expect(r.status).toBe(200);
    const d = ((await r.json()) as any).data;
    const kinds = (k: string) => d.items.filter((i: any) => i.kind === k);
    expect(kinds("klinik_tindak_lanjut").map((i: any) => i.title).sort()).toEqual(["Klinik Telat Baru", "Klinik Telat Lama"]);
    expect(kinds("klinik_tindak_lanjut").find((i: any) => i.title === "Klinik Telat Lama").severity).toBe("tinggi");
    expect(kinds("klinik_tindak_lanjut").find((i: any) => i.title === "Klinik Telat Baru").severity).toBe("sedang");
    expect(kinds("kepatuhan_lewat").length).toBe(1);
    expect(kinds("kepatuhan_lewat")[0].due_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(kinds("kepatuhan_habis").length).toBe(1);
    expect(kinds("sampel_telat").map((i: any) => i.detail)).toEqual(["Sampel telat"]);
    expect(kinds("pesanan_baru").map((i: any) => i.title)).toEqual(["Pesanan Lama"]);
    expect(kinds("kampanye_jadwal").map((i: any) => i.title)).toEqual(["Besok"]);
    expect(JSON.stringify(d)).not.toMatch(/liyin/i);
    // urutan severity
    const rank: any = { tinggi: 0, sedang: 1, info: 2 };
    const sev = d.items.map((i: any) => rank[i.severity]); expect([...sev].sort((a, b) => a - b)).toEqual(sev);
    // counts dari semua yang cocok, bukan terpotong limit
    expect(d.total).toBe(2 + 1 + 1 + 1 + 1 + 1);
    const t: any = await (await call("/api/pengingat?limit=2")).json();
    expect(t.data.items.length).toBe(2); expect(t.data.total).toBe(d.total); expect(t.data.counts.klinik_tindak_lanjut).toBe(2);
    // tidak ada perubahan data
    expect(await count(db)).toEqual(before);
    // validasi & auth
    expect((await call("/api/pengingat?foo=1")).status).toBe(400);
    expect((await app.request("/api/pengingat", {}, env)).status).toBe(401);
    expect((await app.request("/api/pengingat", { method: "POST", headers: H }, env)).status).toBeGreaterThanOrEqual(400);
  });
});
