import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
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

export { liveRoutes };
