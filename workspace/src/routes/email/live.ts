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

export { liveRoutes };
