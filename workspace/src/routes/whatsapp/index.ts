import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok } from "../../lib/http";
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
