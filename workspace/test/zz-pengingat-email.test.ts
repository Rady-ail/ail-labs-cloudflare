import { describe, test, expect } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const H = { Authorization: "Bearer tok" };

describe("pengingat: email belum dibalas & sampel menunggu keputusan", () => {
  test("hanya thread terhubung yang pesan terakhirnya masuk dari pihak luar", async () => {
    const db = await getDb();
    await db.exec(`
      INSERT INTO email_threads (external_thread_id, subject, last_message_at, metadata) VALUES
        ('t-a', 'Perlu dibalas', now() - interval '1 day', '{"link":{"kind":"supplier","id":"x","name":"Sup Email"}}'),
        ('t-b', 'Sudah dibalas', now() - interval '1 day', '{"link":{"kind":"supplier","id":"x","name":"Sup Email"}}'),
        ('t-c', 'Tidak terhubung', now() - interval '1 day', '{}'),
        ('t-d', 'Dari Rady sendiri', now() - interval '1 day', '{"link":{"kind":"supplier","id":"x","name":"Sup Email"}}');
      INSERT INTO email_messages (thread_id, direction, from_email, subject, body_text, received_at)
        SELECT id, 'inbound', 'a@sup.com', 'x', 'hi', now() - interval '1 day' FROM email_threads WHERE external_thread_id = 't-a';
      INSERT INTO email_messages (thread_id, direction, from_email, subject, body_text, received_at)
        SELECT id, 'inbound', 'a@sup.com', 'x', 'hi', now() - interval '2 days' FROM email_threads WHERE external_thread_id = 't-b';
      INSERT INTO email_messages (thread_id, direction, from_email, subject, body_text, received_at)
        SELECT id, 'outbound', 'alexa@inbox.ail-aesthetic-labs.my.id', 'x', 'balas', now() - interval '1 day' FROM email_threads WHERE external_thread_id = 't-b';
      INSERT INTO email_messages (thread_id, direction, from_email, subject, body_text, received_at)
        SELECT id, 'inbound', 'a@sup.com', 'x', 'hi', now() - interval '1 day' FROM email_threads WHERE external_thread_id = 't-c';
      INSERT INTO email_messages (thread_id, direction, from_email, subject, body_text, received_at)
        SELECT id, 'inbound', 'radyp13@gmail.com', 'x', 'hi', now() - interval '1 day' FROM email_threads WHERE external_thread_id = 't-d';
      INSERT INTO suppliers (slug, name, category, status) VALUES ('sup-kep', 'Sup Keputusan', 'skincare_oem', 'sampel_berjalan');
      INSERT INTO supplier_samples (supplier_id, description, state) SELECT id, 'Sampel X', 'disepakati' FROM suppliers WHERE slug = 'sup-kep';
    `);
    const r = await app.request("/api/pengingat", { headers: H }, env);
    expect(r.status).toBe(200);
    const d = ((await r.json()) as any).data;
    const em = d.items.filter((i: any) => i.kind === "email_belum_dibalas");
    expect(em.length).toBe(1);
    expect(em[0].title).toContain("Perlu dibalas");
    expect(d.counts.email_belum_dibalas).toBe(1);
    expect(d.items.filter((i: any) => i.kind === "sampel_keputusan").map((i: any) => i.title)).toEqual(["Sup Keputusan"]);
  });
});
