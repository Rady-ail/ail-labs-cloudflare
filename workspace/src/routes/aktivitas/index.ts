import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError, ok } from "../../lib/http";
import { getSql } from "../../lib/db";
import { clampInt } from "../../lib/validate";

export const aktivitasRoutes = new Hono<AppEnv>();

function bad(message: string, fields?: Record<string, string>): never {
  throw new ValidationError("BAD_REQUEST", message, fields ? { fields } : undefined);
}
function esc(v: string) { return v.replace(/[\\%_]/g, "\\$&"); }
const iso = (v: unknown) => { const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

// Log aktivitas hanya-baca (audit_log). Tidak ada penulisan dari endpoint ini.
aktivitasRoutes.get("/", async (c) => {
  const q = c.req.query();
  const unknown = Object.keys(q).filter((k) => !["ok", "q", "limit"].includes(k));
  if (unknown.length) bad("Parameter tidak dikenal.", Object.fromEntries(unknown.map((k) => [k, "Parameter tidak dikenal."])));
  let okFilter: boolean | null = null;
  if (q.ok !== undefined && q.ok !== "") {
    if (q.ok !== "true" && q.ok !== "false") bad("Filter ok tidak valid.");
    okFilter = q.ok === "true";
  }
  const prefix = q.q?.trim() ? `${esc(q.q.trim().slice(0, 60))}%` : null;
  const limit = clampInt(q.limit, 1, 200, 100);
  const sql = getSql(c.env);
  const rows = await sql`SELECT id, actor, action, resource_type, resource_id, request_id, ok, created_at
    FROM audit_log
    WHERE (${okFilter}::boolean IS NULL OR ok = ${okFilter})
      AND (${prefix}::text IS NULL OR action ILIKE ${prefix} ESCAPE '\\')
    ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  return ok(c, rows.map((r: Record<string, any>) => ({ ...r, id: String(r.id), created_at: iso(r.created_at) })));
});

aktivitasRoutes.get("/summary", async (c) => {
  if (Object.keys(c.req.query()).length) bad("Endpoint summary tidak menerima parameter.");
  const sql = getSql(c.env);
  const [tot, per, last] = await Promise.all([
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT ok)::int AS failed
      FROM audit_log WHERE created_at > now() - interval '24 hours'`,
    sql`SELECT resource_type, count(*)::int AS total FROM audit_log
      WHERE created_at > now() - interval '24 hours' GROUP BY resource_type ORDER BY total DESC LIMIT 10`,
    sql`SELECT max(created_at) AS at FROM audit_log`,
  ]);
  return ok(c, {
    last_24h: tot[0] ?? { total: 0, failed: 0 },
    by_resource: per,
    last_event_at: last[0]?.at ? iso(last[0].at) : null,
  });
});
