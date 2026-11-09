import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
import { processReceived, resolveReceivedData } from "./webhook";
import { assertNoQuery, assertQueryKeys, badRequest } from "./shared";

const liveRoutes = new Hono<AppEnv>();

liveRoutes.get("/live/status", async (c) => {
  assertNoQuery(c);
  try {
    const sql = getSql(c.env);
    await sql`SELECT 1`;
    return ok(c, { database: "online", emailSending: "disabled", provider: "none" });
  } catch {
    return fail(c, 503, "DATABASE_UNAVAILABLE", "Status email tidak tersedia");
  }
});

liveRoutes.get("/live/new-count", async (c) => {
  const query = c.req.query();
  assertQueryKeys(query, ["since"]);
  const since = query.since;
  if (!since || since.length > 50 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(since)
    || Number.isNaN(Date.parse(since))) {
    badRequest("since wajib berupa timestamp ISO 8601 dengan zona waktu");
  }
  const sql = getSql(c.env);
  const rows = await sql`SELECT count(*)::int AS count,
      COALESCE(json_agg(id ORDER BY received_at DESC), '[]'::json) AS ids
    FROM (
      SELECT id::text AS id, received_at
      FROM email_messages
      WHERE direction = 'inbound' AND received_at >= ${new Date(since).toISOString()}::timestamptz
      ORDER BY received_at DESC, id DESC
    ) incoming`;
  return ok(c, { count: Number(rows[0]?.count ?? 0), ids: rows[0]?.ids ?? [] });
});

// Tarik email masuk lama dari Resend yang belum tercatat (satu halaman per panggilan).
liveRoutes.post("/live/sync", async (c) => {
  assertNoQuery(c);
  if (!c.env.RESEND_API_KEY) return fail(c, 503, "RESEND_UNAVAILABLE", "Kunci Resend belum diatur");
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { body = {}; }
  const unknown = Object.keys(body).filter((k) => !["limit", "after"].includes(k));
  if (unknown.length) badRequest("Field tidak dikenal");
  const limit = body.limit === undefined ? 20 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) badRequest("limit harus 1-25");
  const after = body.after === undefined ? "" : String(body.after);
  if (after && !/^[A-Za-z0-9-]{8,80}$/.test(after)) badRequest("after tidak valid");
  const url = `https://api.resend.com/emails/receiving?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` } });
  if (!res.ok) return fail(c, 503, "RESEND_ERROR", "Resend menolak permintaan");
  const page = (await res.json()) as { data?: Array<Record<string, any>>; has_more?: boolean };
  const items = Array.isArray(page.data) ? page.data : [];
  const sql = getSql(c.env);
  let imported = 0;
  for (const item of [...items].reverse()) {
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) continue;
    const exists = await sql`SELECT 1 FROM email_messages WHERE resend_email_id = ${id}::text LIMIT 1`;
    if (exists.length) continue;
    const data = await resolveReceivedData(c.env, { ...item, email_id: id });
    await processReceived(sql, data);
    imported += 1;
  }
  const last = items.length ? String(items[items.length - 1].id ?? "") : "";
  return ok(c, { seen: items.length, imported, has_more: Boolean(page.has_more), next_after: page.has_more ? last : null });
});

// Unduh lampiran email masuk (diambil langsung dari Resend, tidak disimpan di server).
liveRoutes.get("/attachments/:id/download", async (c) => {
  assertNoQuery(c);
  const id = c.req.param("id");
  if (!/^\d{1,18}$/.test(id)) badRequest("id tidak valid");
  if (!c.env.RESEND_API_KEY) return fail(c, 503, "RESEND_UNAVAILABLE", "Kunci Resend belum diatur");
  const sql = getSql(c.env);
  const rows = await sql`SELECT a.filename, a.content_type, a.byte_size, a.provider_attachment_id, m.resend_email_id
    FROM email_attachments a JOIN email_messages m ON m.id = a.message_id
    WHERE a.id = ${id}::bigint AND m.direction = 'inbound' LIMIT 1`;
  const row = rows[0];
  if (!row || !row.provider_attachment_id || !row.resend_email_id) return fail(c, 404, "NOT_FOUND", "Lampiran tidak ditemukan");
  if (row.byte_size && Number(row.byte_size) > 25 * 1024 * 1024) return fail(c, 413, "TOO_LARGE", "Lampiran terlalu besar");
  const meta = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(row.resend_email_id)}/attachments/${encodeURIComponent(row.provider_attachment_id)}`,
    { headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` } });
  if (!meta.ok) return fail(c, 503, "RESEND_ERROR", "Lampiran tidak bisa diambil dari Resend");
  const info = (await meta.json()) as Record<string, any>;
  const url = typeof info.download_url === "string" ? info.download_url : "";
  if (!/^https:\/\//.test(url)) return fail(c, 503, "RESEND_ERROR", "Tautan unduhan tidak tersedia");
  const file = await fetch(url);
  if (!file.ok || !file.body) return fail(c, 503, "RESEND_ERROR", "Lampiran tidak bisa diunduh");
  const name = String(row.filename || "lampiran").replace(/[\r\n"\\]/g, "_").slice(0, 200);
  return new Response(file.body, { status: 200, headers: {
    "Content-Type": String(row.content_type || "application/octet-stream"),
    "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});

// Tarik kontak dari Resend ke CRM (klinik) dan daftar jangan-kirim. Satu halaman per panggilan.
liveRoutes.post("/live/sync-contacts", async (c) => {
  assertNoQuery(c);
  if (!c.env.RESEND_API_KEY) return fail(c, 503, "RESEND_UNAVAILABLE", "Kunci Resend belum diatur");
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { body = {}; }
  const unknown = Object.keys(body).filter((k) => !["segment_id", "after", "province"].includes(k));
  if (unknown.length) badRequest("Field tidak dikenal");
  const segment = body.segment_id === undefined ? "" : String(body.segment_id);
  if (segment && !/^[A-Za-z0-9-]{8,80}$/.test(segment)) badRequest("segment_id tidak valid");
  const after = body.after === undefined ? "" : String(body.after);
  if (after && !/^[A-Za-z0-9-]{8,80}$/.test(after)) badRequest("after tidak valid");
  const province = body.province === undefined ? "-" : String(body.province).trim().slice(0, 80);
  if (!province) badRequest("province tidak valid");
  const qs = new URLSearchParams({ limit: "100" });
  if (segment) qs.set("segment_id", segment);
  if (after) qs.set("after", after);
  const res = await fetch(`https://api.resend.com/contacts?${qs}`, { headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` } });
  if (!res.ok) return fail(c, 503, "RESEND_ERROR", "Resend menolak permintaan");
  const page = (await res.json()) as { data?: Array<Record<string, any>>; has_more?: boolean };
  const items = Array.isArray(page.data) ? page.data : [];
  const seen = new Set<string>();
  const rows: Array<{ name: string; email: string }> = [];
  const stops: Array<{ email: string }> = [];
  for (const item of items) {
    const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) continue;
    if (email.endsWith("@inbox.ail-aesthetic-labs.my.id") || /salinan/i.test(String(item.first_name ?? ""))) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    const name = [item.first_name, item.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ").trim().slice(0, 200) || email;
    rows.push({ name, email });
    if (item.unsubscribed === true) stops.push({ email });
  }
  const sql = getSql(c.env);
  let added = 0;
  let blocked = 0;
  if (rows.length) {
    const ins = await sql`INSERT INTO clinics (name, city, province, stage, email, notes)
      SELECT v.name, '-', ${province}, 'lead', v.email, 'Sumber: kontak Resend'
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(name text, email text)
      WHERE NOT EXISTS (SELECT 1 FROM clinics c WHERE lower(c.email) = v.email)
      RETURNING 1`;
    added = ins.length;
  }
  if (stops.length) {
    const sup = await sql`INSERT INTO email_suppressions (email, reason, source)
      SELECT v.email, 'unsubscribe', 'resend_contacts'
      FROM jsonb_to_recordset(${JSON.stringify(stops)}::jsonb) AS v(email text)
      WHERE NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email) = v.email)
      RETURNING 1`;
    blocked = sup.length;
  }
  const last = items.length ? String(items[items.length - 1].id ?? "") : "";
  return ok(c, { seen: items.length, clinics_added: added, suppressed_added: blocked, has_more: Boolean(page.has_more), next_after: page.has_more ? last : null });
});

export { liveRoutes };
