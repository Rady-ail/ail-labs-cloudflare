import { describe, test, expect, vi } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
import { isStopReply, replyHead } from "../src/routes/email/link";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run", RESEND_API_KEY: "re_x" };
const H = { Authorization: "Bearer tok", "Content-Type": "application/json" };

describe("deteksi STOP", () => {
  test("hanya kalimat pembuka, bukan kutipan", () => {
    expect(isStopReply("STOP Dari: Alexa ...")).toBe(true);
    expect(isStopReply("Berhenti\n\nPada Min, 25 Okt 2026 pukul 10.00 Alexa menulis:\n> ...")).toBe(true);
    expect(isStopReply("Hallo ada infus apa saja\n> kalau mau berhenti balas STOP")).toBe(false);
    expect(isStopReply("Mohon jangan kirim lagi ya")).toBe(true);
    expect(isStopReply("Stok infus ada?")).toBe(false);
    expect(replyHead("Halo\n> kutipan")).toBe("Halo");
  });
});

describe("hubungkan email masuk", () => {
  test("klinik naik tahap, STOP -> inactive + daftar jangan-kirim, supplier last_activity, idempoten", async () => {
    const db: any = await getDb();
    await db.exec(`
      INSERT INTO clinics (name, city, province, stage, email) VALUES
        ('Klinik A','K','P','lead','a@klinik.id'), ('Klinik B','K','P','lead','b@klinik.id'), ('Klinik C','K','P','negotiating','c@klinik.id');
      INSERT INTO suppliers (slug, name, category, status, channel) VALUES
        ('sup-x','Sup X','skincare_oem','kandidat','ann@sup-x.com / WA'), ('liyin-y','Liyin Y','skincare_oem','kandidat','yo@liyin.com');
    `);
    const mk = async (from: string, body: string, rid: string, at: string) => {
      const t = (await db.query(`INSERT INTO email_threads (subject, folder) VALUES ('T','inbox') RETURNING id`)).rows[0];
      await db.query(`INSERT INTO email_messages (thread_id, resend_email_id, direction, from_email, to_recipients, subject, body_text, received_at)
        VALUES ($1,$2,'inbound',$3,'[]'::jsonb,'T',$4,$5)`, [t.id, rid, from, body, at]);
    };
    await mk("a@klinik.id", "Hallo ada infus apa saja", "lk-1", "2026-11-05T01:00:00Z");
    await mk("b@klinik.id", "STOP", "lk-2", "2026-11-06T01:00:00Z");
    await mk("c@klinik.id", "ok", "lk-3", "2026-11-06T02:00:00Z");
    await mk("other@sup-x.com", "Quotation attached", "lk-4", "2026-11-07T01:00:00Z");
    await mk("yo@liyin.com", "hi", "lk-5", "2026-11-07T02:00:00Z");
    await mk("nobody@gmail.com", "hi", "lk-6", "2026-11-07T03:00:00Z");
    await mk("alexa@inbox.ail-aesthetic-labs.my.id", "sent copy", "lk-7", "2026-11-07T04:00:00Z");
    const call = async () => (await (await app.request("/api/email/live/relink", { method: "POST", headers: H }, env)).json() as any).data;
    const r = { processed: 0, clinic: 0, supplier: 0, remaining: 1 };
    for (let i = 0; i < 5 && r.remaining > 0; i++) {
      const x = await call();
      r.processed += x.processed; r.clinic += x.clinic; r.supplier += x.supplier; r.remaining = x.remaining;
    }
    expect(r.processed).toBeGreaterThanOrEqual(7);
    expect(r.clinic).toBe(3);
    expect(r.supplier).toBe(1);
    expect(r.remaining).toBe(0);
    const cl = (await db.query(`SELECT email, stage, interactions_count n FROM clinics WHERE email LIKE '%@klinik.id' ORDER BY email`)).rows;
    expect(cl.map((x: any) => [x.email, x.stage, Number(x.n)])).toEqual([["a@klinik.id","contacted",1],["b@klinik.id","inactive",1],["c@klinik.id","negotiating",1]]);
    expect((await db.query(`SELECT count(*)::int n FROM email_suppressions WHERE email='b@klinik.id'`)).rows[0].n).toBe(1);
    expect((await db.query(`SELECT last_activity_on::text d FROM suppliers WHERE slug='sup-x'`)).rows[0].d).toBe("2026-11-07");
    expect((await db.query(`SELECT last_activity_on FROM suppliers WHERE slug='liyin-y'`)).rows[0].last_activity_on).toBeNull();
    const again = await call();
    expect(again.processed).toBe(0);
    expect((await db.query(`SELECT interactions_count n FROM clinics WHERE email='a@klinik.id'`)).rows[0].n).toBe(1);
  });
});
