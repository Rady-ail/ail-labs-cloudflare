import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { getSql } from "../../lib/db";
import { isStopReply } from "../email/link";
import { WA_IN_SUMMARY } from "./index";

// Webhook WhatsApp Cloud API (Meta). Verifikasi GET dengan verify token, POST dengan X-Hub-Signature-256.
// Pesan masuk (dan echo pesan yang dikirim dari aplikasi HP) dicatat sebagai aktivitas klinik.
export const whatsappWebhookRoutes = new Hono<AppEnv>();
const MAX_BODY = 1_048_576;
const MAX_MESSAGES = 12; // batas subrequest Worker per panggilan

function eq(a: string, b: string): boolean {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) d |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  return d === 0;
}

async function validSignature(secret: string, raw: string, header: string): Promise<boolean> {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header ?? "");
  if (!secret || !m) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return eq(hex, m[1].toLowerCase());
}

export function normPhone(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return "62" + d.slice(1);
  if (d.startsWith("8")) return "62" + d;
  return d;
}

function bodyOf(m: Record<string, any>): string {
  if (m.type === "text") return String(m.text?.body ?? "");
  if (m.type === "button") return String(m.button?.text ?? "");
  if (m.type === "interactive") return String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "");
  return `[${String(m.type ?? "pesan")}]`;
}

whatsappWebhookRoutes.get("/api/webhooks/whatsapp", (c) => {
  const token = c.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return c.text("Webhook WhatsApp belum dikonfigurasi.", 503);
  const q = c.req.query();
  if (q["hub.mode"] === "subscribe" && typeof q["hub.verify_token"] === "string" && eq(q["hub.verify_token"], token) && q["hub.challenge"]) {
    return c.text(q["hub.challenge"], 200);
  }
  return c.text("Forbidden", 403);
});

whatsappWebhookRoutes.post("/api/webhooks/whatsapp", async (c) => {
  const secret = c.env.WHATSAPP_APP_SECRET;
  if (!secret) return c.json({ error: "Webhook WhatsApp belum dikonfigurasi." }, 503);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: "Terlalu besar" }, 413);
  if (!(await validSignature(secret, raw, c.req.header("X-Hub-Signature-256") ?? ""))) return c.json({ error: "Tanda tangan tidak valid" }, 401);
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return c.json({ error: "JSON tidak valid" }, 400); }

  type Ev = { phone: string; id: string; text: string; at: Date; out: boolean };
  const events: Ev[] = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        events.push({ phone: normPhone(m.from), id: String(m.id ?? ""), text: bodyOf(m), at: new Date(Number(m.timestamp) * 1000 || Date.now()), out: false });
      }
      for (const m of Array.isArray(v.message_echoes) ? v.message_echoes : []) {
        events.push({ phone: normPhone(m.to), id: String(m.id ?? ""), text: bodyOf(m), at: new Date(Number(m.timestamp) * 1000 || Date.now()), out: true });
      }
    }
  }

  const sql = getSql(c.env);
  let recorded = 0, unmatched = 0, duplicate = 0;
  for (const e of events.slice(0, MAX_MESSAGES)) {
    if (!e.phone || !e.id) continue;
    const tag = `[wa:${e.id}]`;
    const found = await sql`SELECT id::text AS id FROM clinics WHERE archived IS NOT TRUE AND phone = ${e.phone} ORDER BY created_at LIMIT 1`;
    if (!found.length) { unmatched += 1; continue; }
    const clinicId = (found[0] as any).id as string;
    const text = e.text.slice(0, 800);
    const summary = e.out ? "Pesan WhatsApp terkirim dari HP" : WA_IN_SUMMARY;
    const ins = await sql`INSERT INTO clinic_activities (clinic_id, type, summary, detail, occurred_at)
      SELECT ${clinicId}::uuid, 'whatsapp', ${summary}, ${text + "\n" + tag}, ${e.at.toISOString()}::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM clinic_activities WHERE clinic_id = ${clinicId}::uuid AND detail LIKE ${"%" + tag})
      RETURNING id`;
    if (!ins.length) { duplicate += 1; continue; }
    recorded += 1;
    const stop = !e.out && isStopReply(text);
    await sql`UPDATE clinics SET
        last_contact_at = GREATEST(COALESCE(last_contact_at, ${e.at.toISOString()}::timestamptz), ${e.at.toISOString()}::timestamptz),
        interactions_count = interactions_count + 1,
        stage = CASE WHEN ${stop} AND stage IN ('lead', 'contacted') THEN 'inactive'
                     WHEN ${!e.out} AND stage = 'lead' THEN 'contacted' ELSE stage END,
        updated_at = now()
      WHERE id = ${clinicId}::uuid`;
  }
  return c.json({ ok: true, received: events.length, recorded, duplicate, unmatched }, 200);
});
