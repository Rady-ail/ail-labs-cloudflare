import { describe, test, expect } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const H = { Authorization: "Bearer tok", "Content-Type": "application/json" };
const req = (p: string, method = "GET", body?: unknown) => app.request(p, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }, env);

describe("kampanye: daftar kirim manual WhatsApp", () => {
  test("daftar, tandai, batal tandai, validasi", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO clinics (name, city, province, stage, phone, archived) VALUES
      ('Manual A', 'Kota', 'Bali', 'lead', '0812111', false),
      ('Manual B', 'Kota', 'Bali', 'lead', ' 0812222 ', false),
      ('Manual Tanpa Nomor', 'Kota', 'Bali', 'lead', NULL, false),
      ('Manual Arsip', 'Kota', 'Bali', 'lead', '0812333', true),
      ('Manual Lain Provinsi', 'Kota', 'Riau', 'lead', '0812444', false);`);
    const mk = async (name: string, channel: string) => ((await (await req("/api/kampanye/campaigns", "POST", { name, channel, body: "Halo {nama}", audience_filter: { region: ["Bali"] }, daily_limit: 5 })).json()) as any).data;
    const wa = await mk("Manual WA", "whatsapp");
    const em = await mk("Manual EM", "email");

    let r = await req(`/api/kampanye/campaigns/${wa.id}/recipients`);
    expect(r.status).toBe(200);
    let j: any = await r.json();
    const names = j.data.map((x: any) => x.name).sort();
    expect(names.filter((n: string) => n.startsWith("Manual "))).toEqual(["Manual A", "Manual B"]);
    expect(j.data.every((x: any) => x.state === "belum")).toBe(true);
    expect(j.data.find((x: any) => x.name === "Manual B").phone).toBe("0812222");
    expect(j.meta.messages_sent_by_app).toBe(0);
    expect(j.meta.sent_today).toBe(0);
    expect(j.meta.daily_limit).toBe(5);

    const a = j.data.find((x: any) => x.name === "Manual A");
    const before = (await db.query(`SELECT count(*)::int n FROM audit_log`)).rows[0] as any;
    r = await req(`/api/kampanye/campaigns/${wa.id}/recipients/${a.clinic_id}`, "PUT", { state: "terkirim_manual" });
    expect(r.status).toBe(200);
    j = await (await req(`/api/kampanye/campaigns/${wa.id}/recipients`)).json();
    expect(j.data.find((x: any) => x.clinic_id === a.clinic_id).state).toBe("terkirim_manual");
    expect(j.meta.sent_total).toBe(1); expect(j.meta.sent_today).toBe(1);
    expect(j.data[j.data.length - 1].clinic_id).toBe(a.clinic_id); // yang sudah dikirim turun ke bawah
    const after = (await db.query(`SELECT count(*)::int n FROM audit_log`)).rows[0] as any;
    expect(after.n).toBe(before.n + 1);

    r = await req(`/api/kampanye/campaigns/${wa.id}/recipients/${a.clinic_id}`, "PUT", { state: "antre" });
    expect(r.status).toBe(200);
    j = await (await req(`/api/kampanye/campaigns/${wa.id}/recipients`)).json();
    expect(j.meta.sent_total).toBe(0);

    // klinik di luar audiens / arsip / tanpa nomor -> 404
    for (const n of ["Manual Arsip", "Manual Tanpa Nomor", "Manual Lain Provinsi"]) {
      const id = ((await db.query(`SELECT id FROM clinics WHERE name = '${n}'`)).rows[0] as any).id;
      expect((await req(`/api/kampanye/campaigns/${wa.id}/recipients/${id}`, "PUT", { state: "terkirim_manual" })).status).toBe(404);
    }
    // validasi
    expect((await req(`/api/kampanye/campaigns/${wa.id}/recipients/${a.clinic_id}`, "PUT", { state: "terkirim_simulasi" })).status).toBe(422);
    expect((await req(`/api/kampanye/campaigns/${wa.id}/recipients/${a.clinic_id}`, "PUT", { state: "antre", x: 1 })).status).toBe(400);
    expect((await req(`/api/kampanye/campaigns/${wa.id}/recipients/bukan-uuid`, "PUT", { state: "antre" })).status).toBe(400);
    expect((await req(`/api/kampanye/campaigns/${wa.id}/recipients?foo=1`)).status).toBe(400);
    expect((await req(`/api/kampanye/campaigns/${em.id}/recipients`)).status).toBe(200);
    expect((await req(`/api/kampanye/campaigns/00000000-0000-4000-8000-000000000000/recipients`)).status).toBe(404);
    expect((await app.request(`/api/kampanye/campaigns/${wa.id}/recipients`, {}, env)).status).toBe(401);
    // dibatalkan -> tidak bisa diubah
    await req(`/api/kampanye/campaigns/${wa.id}`, "PATCH", { status: "dibatalkan" });
    expect((await req(`/api/kampanye/campaigns/${wa.id}/recipients/${a.clinic_id}`, "PUT", { state: "terkirim_manual" })).status).toBe(409);
  });
});

describe("kampanye: daftar kirim manual Email/Gmail", () => {
  test("email dengan fallback kontak, bounce dikecualikan, tanda kirim", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO clinics (name, city, province, stage, email, archived) VALUES
      ('Mail A', 'Kota', 'Jambi', 'lead', 'a@mail.test', false),
      ('Mail Bounce', 'Kota', 'Jambi', 'lead', 'bounce@mail.test', false),
      ('Mail Kontak', 'Kota', 'Jambi', 'lead', NULL, false),
      ('Mail Kosong', 'Kota', 'Jambi', 'lead', '  ', false);
      INSERT INTO email_suppressions (email, reason, source) VALUES ('BOUNCE@mail.test', 'bounce', 'test');`);
    const kid = ((await db.query(`SELECT id FROM clinics WHERE name = 'Mail Kontak'`)).rows[0] as any).id;
    await db.exec(`INSERT INTO clinic_contacts (clinic_id, name, email, is_primary) VALUES ('${kid}', 'PIC', 'kontak@mail.test', true)`);
    const camp = ((await (await req("/api/kampanye/campaigns", "POST", { name: "Manual Gmail", channel: "email", subject: "Halo", body: "Isi", audience_filter: { region: ["Jambi"] } })).json()) as any).data;
    const j: any = await (await req(`/api/kampanye/campaigns/${camp.id}/recipients`)).json();
    expect(j.data.map((x: any) => x.email).sort()).toEqual(["a@mail.test", "kontak@mail.test"]);
    expect(j.data.every((x: any) => x.phone === null)).toBe(true);
    expect(j.meta.channel).toBe("email"); expect(j.meta.total).toBe(2);
    const a = j.data.find((x: any) => x.email === "a@mail.test");
    expect((await req(`/api/kampanye/campaigns/${camp.id}/recipients/${a.clinic_id}`, "PUT", { state: "terkirim_manual" })).status).toBe(200);
    const bid = ((await db.query(`SELECT id FROM clinics WHERE name = 'Mail Bounce'`)).rows[0] as any).id;
    expect((await req(`/api/kampanye/campaigns/${camp.id}/recipients/${bid}`, "PUT", { state: "terkirim_manual" })).status).toBe(404);
    const j2: any = await (await req(`/api/kampanye/campaigns/${camp.id}/recipients`)).json();
    expect(j2.meta.sent_total).toBe(1);
  });
});
