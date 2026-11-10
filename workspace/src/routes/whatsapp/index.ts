import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok, fail, ValidationError } from "../../lib/http";
import { readJsonObject } from "../../lib/body";
import { audit } from "../../lib/audit";
import { getSql } from "../../lib/db";

// Kuota harian outreach WhatsApp: 15 pesan/hari, jeda minimal 3 menit (menjaga nomor dari pembatasan Meta).
export const whatsappRoutes = new Hono<AppEnv>();
export const WA_DAILY_LIMIT = 15;
export const WA_GAP_MS = 3 * 60_000;
export const WA_IN_SUMMARY = "Balasan WhatsApp masuk";

whatsappRoutes.get("/kuota", async (c) => {
  const sql = getSql(c.env);
  const rows = await sql`SELECT count(*)::int AS used, max(occurred_at) AS last_at
    FROM clinic_activities
    WHERE type = 'whatsapp' AND summary <> ${WA_IN_SUMMARY}
      AND (occurred_at AT TIME ZONE 'Asia/Makassar')::date = (now() AT TIME ZONE 'Asia/Makassar')::date`;
  const r = (rows[0] ?? {}) as Record<string, any>;
  const used = Number(r.used ?? 0);
  const lastAt = r.last_at ? new Date(r.last_at).toISOString() : null;
  const nextAt = lastAt ? new Date(new Date(lastAt).getTime() + WA_GAP_MS).toISOString() : null;
  const waitMs = nextAt ? Math.max(0, new Date(nextAt).getTime() - Date.now()) : 0;
  return ok(c, {
    used, limit: WA_DAILY_LIMIT, remaining: Math.max(0, WA_DAILY_LIMIT - used),
    last_at: lastAt, next_allowed_at: nextAt, wait_seconds: Math.ceil(waitMs / 1000),
    can_send: used < WA_DAILY_LIMIT && waitMs === 0,
  });
});

// Kotak masuk WhatsApp: aktivitas WA terbaru dari semua klinik (masuk, terkirim dari HP, penawaran dibuka dari app).
whatsappRoutes.get("/pesan", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));
  const sql = getSql(c.env);
  const rows = await sql`SELECT a.id::text AS id, a.clinic_id::text AS clinic_id, c.name AS clinic_name, c.phone,
      a.summary, a.detail, a.occurred_at,
      CASE WHEN a.summary = ${WA_IN_SUMMARY} THEN 'masuk' ELSE 'keluar' END AS arah
    FROM clinic_activities a JOIN clinics c ON c.id = a.clinic_id
    WHERE a.type = 'whatsapp' AND c.archived = false
    ORDER BY a.occurred_at DESC LIMIT ${limit}`;
  const items = rows.map((r: Record<string, any>) => ({
    id: String(r.id), clinic_id: String(r.clinic_id), clinic_name: r.clinic_name, phone: r.phone ?? null,
    arah: r.arah, summary: r.summary, text: String(r.detail ?? "").replace(/\n?\[wa:[^\]]+\]\s*$/, "") || null,
    at: new Date(r.occurred_at).toISOString(),
  }));
  return ok(c, { items });
});

// Antrean kirim hari ini: klinik lead yang belum pernah dihubungi, nomor WA valid, urut minat tertinggi.
whatsappRoutes.get("/antrean", async (c) => {
  const limit = Math.min(30, Math.max(1, Number(c.req.query("limit")) || 15));
  const sql = getSql(c.env);
  const rows = await sql`SELECT id::text AS id, name, city, province, phone, interest
    FROM clinics
    WHERE archived = false AND stage = 'lead' AND last_contact_at IS NULL AND interactions_count = 0
      AND phone ~ '^62[0-9]{8,13}$'
      AND NOT EXISTS (SELECT 1 FROM clinic_activities a WHERE a.clinic_id = clinics.id AND a.type = 'whatsapp')
    ORDER BY interest DESC NULLS LAST, created_at ASC LIMIT ${limit}`;
  const total = (await sql`SELECT count(*)::int AS n FROM clinics
    WHERE archived = false AND stage = 'lead' AND last_contact_at IS NULL AND interactions_count = 0 AND phone ~ '^62[0-9]{8,13}$'`)[0] as Record<string, any>;
  return ok(c, {
    items: rows.map((r: Record<string, any>) => ({ id: String(r.id), name: r.name, city: r.city === "-" ? null : r.city, province: r.province === "-" ? null : r.province, phone: r.phone, interest: r.interest ?? null })),
    total_menunggu: Number(total?.n ?? 0),
  });
});

// ───────── Kirim penawaran lewat WhatsApp Cloud API ─────────
// Aman secara bawaan: tanpa WHATSAPP_SEND_MODE=live hanya simulasi (dry-run). Pesan pembuka ke klinik wajib
// memakai template yang disetujui Meta; {{1}} diisi nama klinik. Kuota 15/hari dan jeda 3 menit tetap berlaku.
const GRAPH = "https://graph.facebook.com/v21.0";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function waKonfigurasi(env: any) {
  const siap = Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
  return {
    siap,
    mode: env.WHATSAPP_SEND_MODE === "live" ? "live" : "dry-run",
    template: String(env.WHATSAPP_TEMPLATE || "perkenalan_produk"),
    bahasa: String(env.WHATSAPP_TEMPLATE_LANG || "id"),
  };
}

export function alasanWa(status: number, code: unknown): string {
  const c = Number(code);
  if (status === 401 || c === 190) return "Token WhatsApp ditolak atau kedaluwarsa. Buat token baru di Meta dan pasang ulang di Cloudflare.";
  if (c === 132001) return "Template pesan belum ada atau belum disetujui Meta. Periksa nama dan bahasa template.";
  if (c === 131026 || c === 1013) return "Nomor ini tidak terdaftar di WhatsApp.";
  if (c === 131048 || c === 130429 || c === 80007) return "Batas pengiriman Meta tercapai. Tunggu dan kurangi frekuensi.";
  if (c === 131030) return "Nomor penerima belum boleh menerima pesan dari nomor uji. Daftarkan di daftar penerima uji Meta.";
  if (c === 131042) return "Metode pembayaran WhatsApp Business belum diatur di Meta.";
  return "Meta menolak pengiriman. Periksa konfigurasi WhatsApp Cloud API.";
}

whatsappRoutes.get("/kirim/status", (c) => ok(c, waKonfigurasi(c.env)));

whatsappRoutes.post("/kirim", async (c) => {
  const cfg = waKonfigurasi(c.env);
  if (!cfg.siap) return fail(c, 503, "WA_BELUM_TERSAMBUNG", "WhatsApp Cloud API belum tersambung: pasang WHATSAPP_TOKEN dan WHATSAPP_PHONE_NUMBER_ID di Cloudflare.");
  const b = await readJsonObject(c);
  const cid = typeof b.clinic_id === "string" ? b.clinic_id : "";
  if (!UUID.test(cid)) throw new ValidationError("VALIDATION", "clinic_id tidak valid");
  const sql = getSql(c.env);
  const rows = await sql`SELECT id::text AS id, name, phone, archived, stage, interactions_count FROM clinics WHERE id = ${cid}::uuid`;
  const cl = rows[0] as Record<string, any> | undefined;
  if (!cl || cl.archived) return fail(c, 404, "NOT_FOUND", "Klinik tidak ditemukan");
  if (!/^62[0-9]{8,13}$/.test(String(cl.phone ?? ""))) throw new ValidationError("VALIDATION", "nomor WhatsApp klinik tidak valid");
  const pernah = await sql`SELECT 1 FROM clinic_activities WHERE clinic_id = ${cid}::uuid AND type = 'whatsapp' LIMIT 1`;
  if (pernah.length || Number(cl.interactions_count) > 0) return fail(c, 409, "SUDAH_DIHUBUNGI", "Klinik ini sudah pernah dihubungi; pesan pembuka tidak dikirim ulang");
  const q = await sql`SELECT count(*)::int AS used, max(occurred_at) AS last_at FROM clinic_activities
    WHERE type = 'whatsapp' AND summary <> ${WA_IN_SUMMARY}
      AND (occurred_at AT TIME ZONE 'Asia/Makassar')::date = (now() AT TIME ZONE 'Asia/Makassar')::date`;
  const used = Number((q[0] as any)?.used ?? 0);
  const last = (q[0] as any)?.last_at ? new Date((q[0] as any).last_at).getTime() : 0;
  if (used >= WA_DAILY_LIMIT) return fail(c, 429, "KUOTA_HABIS", `Kuota harian ${WA_DAILY_LIMIT} pesan sudah terpakai`);
  const tunggu = last ? Math.ceil((last + WA_GAP_MS - Date.now()) / 1000) : 0;
  if (tunggu > 0) return fail(c, 429, "TUNGGU_JEDA", `Tunggu ${tunggu} detik lagi (jeda minimal 3 menit)`);

  if (cfg.mode !== "live") return ok(c, { terkirim: false, simulasi: true, ke: cl.name, template: cfg.template });

  const res = await fetch(`${GRAPH}/${c.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: cl.phone, type: "template",
      template: { name: cfg.template, language: { code: cfg.bahasa }, components: [{ type: "body", parameters: [{ type: "text", text: String(cl.name).slice(0, 60) }] }] },
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return fail(c, 500, "WA_DITOLAK", alasanWa(res.status, j?.error?.code));
  const wamid = String(j?.messages?.[0]?.id ?? "");
  await sql`INSERT INTO clinic_activities (clinic_id, type, summary, detail)
    VALUES (${cid}::uuid, 'whatsapp', 'Penawaran WhatsApp terkirim (Cloud API)', ${"Template " + cfg.template + (wamid ? "\n[wa:" + wamid + "]" : "")})`;
  await sql`UPDATE clinics SET last_contact_at = now(), interactions_count = interactions_count + 1,
    stage = CASE WHEN stage = 'lead' THEN 'contacted' ELSE stage END, updated_at = now() WHERE id = ${cid}::uuid`;
  await audit(sql, { actor: String(c.get("actor") ?? "api"), action: "whatsapp.kirim", resourceType: "clinic", resourceId: cid, requestId: c.get("requestId"), ok: true });
  return ok(c, { terkirim: true, simulasi: false, ke: cl.name, wamid });
});
