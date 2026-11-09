import { describe, test, expect, vi, afterEach } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run", RESEND_API_KEY: "re_x" };
const H = { Authorization: "Bearer tok", "Content-Type": "application/json" };
const post = (b: any, e = env) => app.request("/api/email/live/sync", { method: "POST", headers: H, body: JSON.stringify(b) }, e);
afterEach(() => vi.unstubAllGlobals());

describe("email live sync", () => {
  test("mengimpor email lama sekali, tidak ganda, urutan benar", async () => {
    const db = await getDb();
    const list = { data: [
      { id: "zz-new-1", from: "Sup <a@sup.com>", to: ["alexa@inbox.x.id"], subject: "Re: Halo", created_at: "2026-11-02T01:00:00Z", message_id: "<m2>" },
      { id: "zz-old-1", from: "Sup <a@sup.com>", to: ["alexa@inbox.x.id"], subject: "Halo", created_at: "2026-11-01T01:00:00Z", message_id: "<m1>" },
    ], has_more: true };
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      if (u.includes("/emails/receiving?")) return new Response(JSON.stringify(list), { status: 200 });
      const id = u.split("/").pop();
      return new Response(JSON.stringify({ id, text: "isi " + id }), { status: 200 });
    }));
    const r1 = await post({ limit: 2 });
    expect(r1.status).toBe(200);
    const j1: any = await r1.json();
    expect(j1.data.imported).toBe(2);
    expect(j1.data.next_after).toBe("zz-old-1");
    const r2: any = await (await post({ limit: 2 })).json();
    expect(r2.data.imported).toBe(0);
    const rows = (await db.query(`SELECT count(*)::int n FROM email_messages WHERE resend_email_id LIKE 'zz-%'`)).rows[0];
    expect(rows.n).toBe(2);
    const th = (await db.query(`SELECT last_message_at FROM email_threads t JOIN email_messages m ON m.thread_id=t.id WHERE m.resend_email_id='zz-new-1'`)).rows[0];
    expect(new Date(th.last_message_at).toISOString()).toBe("2026-11-02T01:00:00.000Z");
  });
  test("validasi", async () => {
    expect((await post({ limit: 99 })).status).toBe(400);
    expect((await post({ x: 1 })).status).toBe(400);
    expect((await post({}, { ...env, RESEND_API_KEY: "" })).status).toBe(503);
    expect((await app.request("/api/email/live/sync", { method: "POST", body: "{}" }, env)).status).toBeGreaterThanOrEqual(401);
  });
});

describe("unduh lampiran", () => {
  test("mengalirkan berkas dari Resend; id salah ditolak", async () => {
    const db = await getDb();
    const m = (await db.query(`INSERT INTO email_threads (subject, folder) VALUES ('Lamp','inbox') RETURNING id`)).rows[0];
    const msg = (await db.query(`INSERT INTO email_messages (thread_id, resend_email_id, direction, from_email, to_recipients, subject, body_text) VALUES (${m.id},'zz-att-1','inbound','a@b.com','[]'::jsonb,'Lamp','x') RETURNING id`)).rows[0];
    const att = (await db.query(`INSERT INTO email_attachments (message_id, filename, content_type, byte_size, provider_attachment_id) VALUES (${msg.id},'a"b.pdf','application/pdf',5,'att-9') RETURNING id`)).rows[0];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => u.includes("/attachments/att-9")
      ? new Response(JSON.stringify({ download_url: "https://files.example/x" }), { status: 200 })
      : new Response("HELLO", { status: 200 })));
    const r = await app.request(`/api/email/attachments/${att.id}/download`, { headers: H }, env);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("HELLO");
    expect(r.headers.get("content-disposition")).toContain('a_b.pdf');
    expect((await app.request("/api/email/attachments/abc/download", { headers: H }, env)).status).toBe(400);
    expect((await app.request("/api/email/attachments/999999/download", { headers: H }, env)).status).toBe(404);
  });
});

describe("sinkron kontak Resend", () => {
  test("menambah klinik baru, melewati yang sudah ada, mencatat berhenti langganan", async () => {
    const db: any = await getDb();
    await db.exec(`INSERT INTO clinics (name, city, province, email) VALUES ('Sudah Ada','K','P','ada@klinik.id')`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ has_more: false, data: [
      { id: "c1", email: "ADA@klinik.id", first_name: "Sudah Ada" },
      { id: "c2", email: "baru@klinik.id", first_name: "Klinik", last_name: "Baru" },
      { id: "c3", email: "stop@klinik.id", first_name: "Klinik Stop", unsubscribed: true },
      { id: "c4", email: "radyp13@gmail.com", first_name: "Rady (salinan)" },
      { id: "c5", email: "rusak", first_name: "x" },
    ] }), { status: 200 })));
    const call = () => app.request("/api/email/live/sync-contacts", { method: "POST", headers: H, body: JSON.stringify({ province: "DKI Jakarta" }) }, env);
    const j: any = await (await call()).json();
    expect(j.data.clinics_added).toBe(2);
    expect(j.data.suppressed_added).toBe(1);
    const again: any = await (await call()).json();
    expect(again.data.clinics_added).toBe(0);
    expect(again.data.suppressed_added).toBe(0);
    const r = (await db.query(`SELECT name, province FROM clinics WHERE email='baru@klinik.id'`)).rows[0];
    expect(r.name).toBe("Klinik Baru");
    expect(r.province).toBe("DKI Jakarta");
    expect((await app.request("/api/email/live/sync-contacts", { method: "POST", headers: H, body: JSON.stringify({ x: 1 }) }, env)).status).toBe(400);
  });
});
