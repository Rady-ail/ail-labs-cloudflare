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

describe("paket & bea, email.sent, supplier diam baru", () => {
  test("paket list/patch; pengingat bea; supplier diam hormati arah email terakhir", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO suppliers (slug, name, category, status, last_activity_on) VALUES
        ('sup-bea', 'Sup Bea', 'skincare_oem', 'sampel_berjalan', CURRENT_DATE), ('sup-ball', 'Sup Bola Kita', 'skincare_oem', 'menunggu_balasan', CURRENT_DATE - 20);
      INSERT INTO supplier_samples (supplier_id, description, state, awb, duty_amount_idr, duty_decision)
        SELECT id, 'Sampel bea', 'dikirim', 'AWB999', 155144, 'belum' FROM suppliers WHERE slug = 'sup-bea';`);
    const sid = (await db.query(`SELECT id FROM suppliers WHERE slug = 'sup-ball'`)).rows[0] as any;
    await db.exec(`INSERT INTO email_threads (subject, last_message_at, metadata) VALUES ('Bola', now() - interval '3 days', '{"link":{"kind":"supplier","id":"${sid.id}","name":"Sup Bola Kita"}}');
      INSERT INTO email_messages (thread_id, direction, from_email, subject, body_text, received_at) SELECT id, 'inbound', 'x@sup.com', 'Bola', 'hi', now() - interval '3 days' FROM email_threads WHERE subject = 'Bola'`);
    const list: any = ((await (await app.request("/api/paket", { headers: H }, env)).json()) as any).data;
    const it = list.items.find((i: any) => i.awb === "AWB999");
    expect(it.duty_amount_idr).toBe(155144); expect(list.menunggu_keputusan).toBeGreaterThanOrEqual(1);
    const bad = await app.request(`/api/paket/${it.id}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ duty_decision: "x" }) }, env);
    expect(bad.status).toBe(422);
    const ok2 = await app.request(`/api/paket/${it.id}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ duty_decision: "tidak_bayar" }) }, env);
    expect(ok2.status).toBe(200);
    const d: any = ((await (await app.request("/api/pengingat", { headers: H }, env)).json()) as any).data;
    expect(d.items.some((i: any) => i.kind === "bea_keputusan" && i.title === "Sup Bea")).toBe(false);
    expect(d.items.some((i: any) => i.kind === "supplier_diam" && i.title === "Sup Bola Kita")).toBe(false);
  });
  test("email.sent dari Alexa tercatat di thread yang cocok, idempoten; pengirim lain diabaikan", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO email_threads (subject, last_message_at) VALUES ('Quote X', now() - interval '1 day');
      INSERT INTO email_messages (thread_id, direction, from_email, to_recipients, subject, body_text, received_at)
        SELECT id, 'inbound', 'sales@sup.com', '[]', 'Quote X', 'hi', now() - interval '1 day' FROM email_threads WHERE subject = 'Quote X'`);
    const secretBytes = new TextEncoder().encode("rahasia-uji-12345678");
    const secret = "whsec_" + btoa(String.fromCharCode(...secretBytes));
    const wenv: any = { ...env, RESEND_WEBHOOK_SECRET: secret };
    async function post(payload: any) {
      const raw = JSON.stringify(payload); const id = "msg_" + Math.random().toString(36).slice(2); const ts = String(Math.floor(Date.now() / 1000));
      const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
      return app.request("/api/webhooks/resend", { method: "POST", body: raw, headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": "v1," + btoa(String.fromCharCode(...mac)) } }, wenv);
    }
    const ev = (from: string) => ({ type: "email.sent", data: { email_id: "re_sent_1", from, to: ["sales@sup.com"], subject: "Re: Quote X", created_at: new Date().toISOString() } });
    expect((await post(ev("Alexa | AIL LABS <alexa@inbox.ail-aesthetic-labs.my.id>"))).status).toBe(200);
    expect((await post(ev("Alexa | AIL LABS <alexa@inbox.ail-aesthetic-labs.my.id>"))).status).toBe(200);
    const rows = (await db.query(`SELECT direction FROM email_messages WHERE resend_email_id = 're_sent_1'`)).rows;
    expect(rows.length).toBe(1); expect((rows[0] as any).direction).toBe("outbound");
    const other = { type: "email.sent", data: { email_id: "re_sent_2", from: "rady@ail-aesthetic-labs.my.id", to: ["sales@sup.com"], subject: "Re: Quote X" } };
    expect((await post(other)).status).toBe(200);
    expect((await db.query(`SELECT 1 FROM email_messages WHERE resend_email_id = 're_sent_2'`)).rows.length).toBe(0);
  });
});

describe("saran balasan", () => {
  test("deteksi flag dan susun balasan", async () => {
    const { deteksi, susunBalasan } = await import("../src/routes/email/saran");
    const f = deteksi("We require 100% T/T payment in advance. Samples are charged USD 50. Buyer pays customs duty.");
    const kode = f.map((x) => x.kode);
    expect(kode).toContain("tt_muka"); expect(kode).toContain("sampel_bayar"); expect(kode).toContain("bea_cukai");
    const s = susunBalasan("Anna", f);
    expect(s.jenis).toBe("tolak_muka");
    expect(s.teks).toContain("DDP"); expect(s.teks).toContain("Alexa");
    expect(deteksi("Thanks, we will send samples free by DHL DDP.").some((x) => x.berat === "tinggi")).toBe(false);
  });
  test("endpoint 404 untuk thread tak ada, butuh auth", async () => {
    const r = await app.request("/api/email/threads/999999/saran-balasan", { headers: H }, env);
    expect(r.status).toBe(404);
    const r2 = await app.request("/api/email/threads/1/saran-balasan", {}, env);
    expect(r2.status).toBe(401);
  });
});

describe("agent AI", () => {
  test("status & 503 tanpa kunci, auth wajib", async () => {
    const s = await app.request("/api/agent/status", { headers: H }, env);
    expect((await s.json() as any).data.aktif).toBe(false);
    const r = await app.request("/api/agent/chat", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ pesan: "halo" }) }, env);
    expect(r.status).toBe(503);
    const r2 = await app.request("/api/agent/status", {}, env);
    expect(r2.status).toBe(401);
  });
  test("chat memakai OpenAI (mock fetch) + konteks", async () => {
    const orig = globalThis.fetch; let sent: any = null;
    globalThis.fetch = (async (_u: any, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: "Siap." } }] })); }) as any;
    try {
      const r = await app.request("/api/agent/chat", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ pesan: "apa prioritas?" }) }, { ...env, OPENAI_API_KEY: "k" });
      expect(r.status).toBe(200); expect((await r.json() as any).data.jawaban).toBe("Siap.");
      expect(sent.messages[0].content).toContain("KONTEKS"); expect(sent.messages[0].content).not.toMatch(/liyin/i);
    } finally { globalThis.fetch = orig; }
  });
});

describe("situs katalog", () => {
  test("503 tanpa secret, auth wajib, validasi", async () => {
    const r = await app.request("/api/situs/ringkasan", { headers: H }, env);
    expect(r.status).toBe(503);
    expect((await app.request("/api/situs/ringkasan", {}, env)).status).toBe(401);
    const e2 = { ...env, KATALOG_DATABASE_URL: "postgres://x" };
    const v = await app.request("/api/situs/pelanggan/abc", { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ status: "approved" }) }, e2);
    expect(v.status).toBe(400);
    const v2 = await app.request("/api/situs/pelanggan/3", { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ status: "x" }) }, e2);
    expect(v2.status).toBe(400);
  });
});

describe("agent Claude", () => {
  test("chat via Anthropic (mock) dan status dua penyedia", async () => {
    const orig = globalThis.fetch; let url = ""; let hdr: any = null; let sent: any = null;
    globalThis.fetch = (async (u: any, init: any) => { url = String(u); hdr = init.headers; sent = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: "text", text: "Halo dari Claude." }] })); }) as any;
    try {
      const e2 = { ...env, ANTHROPIC_API_KEY: "ak" };
      const st = (await (await app.request("/api/agent/status", { headers: H }, e2)).json() as any).data;
      expect(st.claude).toBe(true); expect(st.gpt).toBe(false);
      const r = await app.request("/api/agent/chat", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ pesan: "hai" }) }, e2);
      expect(r.status).toBe(200);
      const d = (await r.json() as any).data; expect(d.jawaban).toBe("Halo dari Claude."); expect(d.penyedia).toBe("claude");
      expect(url).toContain("api.anthropic.com"); expect(hdr["x-api-key"]).toBe("ak");
      expect(sent.system).toContain("KONTEKS"); expect(sent.messages.every((m: any) => m.role !== "system")).toBe(true);
    } finally { globalThis.fetch = orig; }
  });
});

describe("pusat kerja", () => {
  const J = { ...H, "Content-Type": "application/json" };
  test("endpoint baca berjalan di database nyata (pglite)", async () => {
    for (const p of ["prioritas", "sampel", "persetujuan", "skor", "agenda", "ringkasan-pagi"]) {
      const r = await app.request(`/api/pusat/${p}`, { headers: H }, env);
      expect(r.status, p).toBe(200);
    }
    expect((await app.request("/api/pusat/prioritas", {}, env)).status).toBe(401);
  });
  test("agenda: buat, tampil, hapus, validasi", async () => {
    const bad = await app.request("/api/pusat/agenda", { method: "POST", headers: J, body: JSON.stringify({ judul: "", mulai: "x" }) }, env);
    expect(bad.status).toBe(400);
    const t = new Date(Date.now() + 86400000).toISOString();
    const r = await app.request("/api/pusat/agenda", { method: "POST", headers: J, body: JSON.stringify({ judul: "Zoom Humedix", mulai: t, jenis: "zoom" }) }, env);
    expect(r.status).toBe(200); const id = ((await r.json()) as any).data.id;
    const l = ((await (await app.request("/api/pusat/agenda", { headers: H }, env)).json()) as any).data;
    expect(l.some((x: any) => x.judul === "Zoom Humedix")).toBe(true);
    expect((await app.request(`/api/pusat/agenda/${id}`, { method: "DELETE", headers: H }, env)).status).toBe(200);
  });
  test("skor supplier, ekspor csv, dry-run ringkasan", async () => {
    const { skorSupplier } = await import("../src/routes/pusat");
    expect(skorSupplier({ status: "hold", hari: 3, sampel: [], bea: [] }).label).toBe("HOLD");
    expect(skorSupplier({ status: "sampel_berjalan", hari: 2, sampel: ["diuji"], bea: [] }).label).toBe("GO");
    expect(skorSupplier({ status: "kandidat", hari: 90, sampel: [], bea: [] }).label).toBe("EXIT");
    for (const j of ["klinik", "supplier", "sampel", "pesanan"]) {
      const r = await app.request(`/api/pusat/ekspor/${j}`, { headers: H }, env);
      expect(r.status, j).toBe(200); expect(r.headers.get("content-type")).toContain("text/csv");
    }
    expect((await app.request("/api/pusat/ekspor/xx", { headers: H }, env)).status).toBe(404);
    const k = await app.request("/api/pusat/ringkasan-pagi/kirim", { method: "POST", headers: H }, env);
    expect(((await k.json()) as any).data.terkirim).toBe(false);
  });
});

describe("situs tahap 2 (validasi)", () => {
  const J = { ...H, "Content-Type": "application/json" };
  const e2 = { ...env, KATALOG_DATABASE_URL: "postgres://x" };
  const req = (p: string, method: string, body?: any) => app.request("/api/situs" + p, { method, headers: J, body: body === undefined ? undefined : JSON.stringify(body) }, e2);
  test("kategori, lead, catatan, follow-up, popup, jadwal menolak input buruk", async () => {
    expect((await req("/kategori", "POST", { name: "  " })).status).toBe(400);
    expect((await req("/kategori/abc", "PATCH", { name: "x" })).status).toBe(400);
    expect((await req("/leads/3", "PATCH", { status: "x" })).status).toBe(400);
    expect((await req("/catatan", "POST", { source: "zzz", source_id: 1, note: "a" })).status).toBe(400);
    expect((await req("/catatan", "POST", { source: "lead", source_id: 1, note: "" })).status).toBe(400);
    expect((await req("/followup", "PUT", { source: "lead", source_id: 1, status: "x" })).status).toBe(400);
    expect((await req("/followup", "PUT", { source: "lead", source_id: 1, next_followup_at: "bukan-tanggal" })).status).toBe(400);
    expect((await req("/pengaturan/promo-popup", "PUT", { active: "ya" })).status).toBe(400);
    expect((await req("/pengaturan/promo-popup", "PUT", { active: true, reappear_hours: 9999 })).status).toBe(400);
    expect((await req("/jadwal-broadcast/2", "PATCH", { aktif: "x" })).status).toBe(400);
    expect((await app.request("/api/situs/kategori", {}, e2)).status).toBe(401);
  });
});
