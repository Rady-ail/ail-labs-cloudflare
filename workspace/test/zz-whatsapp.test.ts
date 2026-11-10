import { describe, test, expect } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run", WHATSAPP_VERIFY_TOKEN: "vt", WHATSAPP_APP_SECRET: "sec" };
const H = { Authorization: "Bearer tok" };

async function sig(body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("sec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("whatsapp", () => {
  test("verifikasi GET", async () => {
    const ok = await app.request("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123", {}, env);
    expect(ok.status).toBe(200); expect(await ok.text()).toBe("123");
    const bad = await app.request("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123", {}, env);
    expect(bad.status).toBe(403);
  });
  test("POST tanpa/ salah tanda tangan ditolak; benar dicatat, idempoten, STOP -> inactive", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO clinics (name, city, province, phone, stage) VALUES ('Klinik WA', 'x', 'x', '6281234567890', 'lead'), ('Klinik Stop', 'x', 'x', '6281999000111', 'contacted')`);
    const payload = { entry: [{ changes: [{ value: { messages: [
      { from: "6281234567890", id: "wamid.A", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Boleh minta katalog" } },
      { from: "081999000111", id: "wamid.B", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "stop kirim" } },
      { from: "6280000000000", id: "wamid.C", timestamp: "1", type: "text", text: { body: "asing" } },
    ] } }] }] };
    const raw = JSON.stringify(payload);
    const noSig = await app.request("/api/webhooks/whatsapp", { method: "POST", body: raw }, env);
    expect(noSig.status).toBe(401);
    const r = await app.request("/api/webhooks/whatsapp", { method: "POST", body: raw, headers: { "X-Hub-Signature-256": await sig(raw) } }, env);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.recorded).toBe(2); expect(j.unmatched).toBe(1);
    const again = await app.request("/api/webhooks/whatsapp", { method: "POST", body: raw, headers: { "X-Hub-Signature-256": await sig(raw) } }, env);
    expect(((await again.json()) as any).duplicate).toBe(2);
    const st = await db.query(`SELECT name, stage FROM clinics WHERE name IN ('Klinik WA','Klinik Stop') ORDER BY name`);
    expect(st.rows.map((x: any) => x.stage)).toEqual(["inactive", "contacted"]);
  });
  test("kuota harian & follow-up 3/7 hari", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO clinics (name, city, province, stage, last_contact_at) VALUES ('Tiga Hari', 'x', 'x', 'contacted', now() - interval '4 days'), ('Tujuh Hari', 'x', 'x', 'contacted', now() - interval '8 days'), ('Baru', 'x', 'x', 'contacted', now() - interval '1 day')`);
    await db.exec(`INSERT INTO clinic_activities (clinic_id, type, summary) SELECT id, 'whatsapp', 'Penawaran produk dibuka via WhatsApp' FROM clinics WHERE name = 'Baru'`);
    const k: any = ((await (await app.request("/api/whatsapp/kuota", { headers: H }, env)).json()) as any).data;
    expect(k.limit).toBe(15); expect(k.used).toBe(1); expect(k.can_send).toBe(false); expect(k.wait_seconds).toBeGreaterThan(0);
    const d: any = ((await (await app.request("/api/pengingat", { headers: H }, env)).json()) as any).data;
    const f = d.items.filter((i: any) => i.kind === "klinik_follow_up");
    expect(f.map((i: any) => i.title).sort()).toEqual(["Tiga Hari", "Tujuh Hari"]);
    expect(f.find((i: any) => i.title === "Tujuh Hari").severity).toBe("tinggi");
    expect(d.counts.klinik_follow_up).toBe(2);
  });
});

describe("whatsapp pesan, laporan, sampel tertahan", () => {
  test("pesan, laporan mingguan, pengingat sampel tertahan", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO clinics (name, city, province, stage) VALUES ('Klinik Pesan', 'x', 'x', 'contacted');
      INSERT INTO clinic_activities (clinic_id, type, summary, detail) SELECT id, 'whatsapp', 'Balasan WhatsApp masuk', E'Halo\\n[wa:wamid.Z]' FROM clinics WHERE name = 'Klinik Pesan';
      INSERT INTO suppliers (slug, name, category, status) VALUES ('sup-awb', 'Sup AWB', 'skincare_oem', 'sampel_berjalan');
      INSERT INTO supplier_samples (supplier_id, description, state, awb, updated_at) SELECT id, 'Jarum', 'dikirim', '123', now() - interval '12 days' FROM suppliers WHERE slug = 'sup-awb'`);
    const p: any = ((await (await app.request("/api/whatsapp/pesan", { headers: H }, env)).json()) as any).data;
    const m = p.items.find((i: any) => i.clinic_name === "Klinik Pesan");
    expect(m.arah).toBe("masuk"); expect(m.text).toBe("Halo");
    const l: any = ((await (await app.request("/api/laporan/mingguan", { headers: H }, env)).json()) as any).data;
    expect(l.wa_masuk).toBeGreaterThanOrEqual(1); expect(l.sampel_berjalan).toBeGreaterThanOrEqual(1);
    const d: any = ((await (await app.request("/api/pengingat", { headers: H }, env)).json()) as any).data;
    expect(d.items.filter((i: any) => i.kind === "sampel_tertahan").map((i: any) => i.title)).toEqual(["Sup AWB"]);
  });
});

describe("antrean WA & supplier diam", () => {
  test("antrean hanya lead belum dihubungi bernomor valid; supplier diam muncul", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO clinics (name, city, province, stage, phone, interest) VALUES
      ('Antri Tinggi', 'x', 'x', 'lead', '6281100000001', 3), ('Antri Rendah', 'x', 'x', 'lead', '6281100000002', 1),
      ('Nomor Buruk', 'x', 'x', 'lead', '0812', 3), ('Sudah Kontak', 'x', 'x', 'contacted', '6281100000003', 3);
      INSERT INTO suppliers (slug, name, category, status, last_activity_on) VALUES ('sup-diam', 'Sup Diam', 'skincare_oem', 'menunggu_balasan', CURRENT_DATE - 12)`);
    const a: any = ((await (await app.request("/api/whatsapp/antrean", { headers: H }, env)).json()) as any).data;
    const names = a.items.map((i: any) => i.name).filter((n: string) => n.startsWith("Antri") || n === "Nomor Buruk" || n === "Sudah Kontak");
    expect(names).toEqual(["Antri Tinggi", "Antri Rendah"]);
    const d: any = ((await (await app.request("/api/pengingat", { headers: H }, env)).json()) as any).data;
    const s = d.items.find((i: any) => i.kind === "supplier_diam" && i.title === "Sup Diam");
    expect(s.severity).toBe("tinggi");
  });
});
