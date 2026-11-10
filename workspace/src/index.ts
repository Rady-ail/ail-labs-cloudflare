import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./env";
import type { AppEnv } from "./lib/http";
import { errorHandler, notFound, newRequestId, fail } from "./lib/http";
import { getSql } from "./lib/db";
import { requireAuth } from "./lib/auth";
import { crmRoutes } from "./routes/crm/clinics";
import { supplierRoutes } from "./routes/supplier";
import { katalogRoutes } from "./routes/katalog";
import { kampanyeRoutes } from "./routes/kampanye";
import { kepatuhanRoutes } from "./routes/kepatuhan";
import { aktivitasRoutes } from "./routes/aktivitas";
import { cariRoutes } from "./routes/cari";
import { pengingatRoutes } from "./routes/pengingat";
import { threadsRoutes } from "./routes/email/threads";
import { draftsRoutes } from "./routes/email/drafts";
import { liveRoutes } from "./routes/email/live";
import { webhookRoutes } from "./routes/email/webhook";
import { whatsappRoutes } from "./routes/whatsapp";
import { whatsappWebhookRoutes } from "./routes/whatsapp/webhook";
import { runScheduledEmailSender } from "./jobs/scheduled-email-sender";

const app = new Hono<AppEnv>();

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;

async function rateKey(ip: string, token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return ip + ":" + tokenHash;
}

function isAllowedOrigin(origin: string | undefined, dev: boolean): boolean {
  if (origin === "https://app.ail-aesthetic-labs.my.id") return true;
  return Boolean(dev && origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin));
}

app.use("*", async (c, next) => {
  c.set("requestId", newRequestId());
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "()");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Content-Security-Policy", "default-src 'none'");
  if (new URL(c.req.url).protocol === "https:") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  await next();
});

app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  const path = c.req.path;
  const isWebhook = path === "/api/webhooks/resend" || path === "/api/webhooks/whatsapp";

  if (!isWebhook && method !== "GET" && method !== "HEAD" && path !== "/api/crm" && !path.startsWith("/api/crm/")) {
    const limited = bodyLimit({
      maxSize: 262144,
      onError: (ctx) => fail(ctx as any, 413, "PAYLOAD_TOO_LARGE", "Ukuran payload terlalu besar"),
    });
    const res = await limited(c, async () => {});
    if (res) return res;
  }

  if (!isWebhook) {
    const origin = c.req.header("Origin");
    const hasBearer = /^Bearer\s+\S+$/i.test(c.req.header("Authorization") ?? "");
    const safe = method === "GET" || method === "HEAD";
    if (origin ? !isAllowedOrigin(origin, c.env.DEV === "1") : !(hasBearer || safe)) {
      return fail(c, 403, "FORBIDDEN", "Origin tidak diizinkan");
    }
  }

  if (!isWebhook) {
    const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
    const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? c.req.header("Cf-Access-Jwt-Assertion") ?? "";
    const key = await rateKey(ip, bearer);
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > RATE_LIMIT) return fail(c, 429, "RATE_LIMITED", "Terlalu banyak permintaan");
    if (rateBuckets.size > 10000) {
      for (const [bucketKey, value] of rateBuckets) {
        if (value.resetAt <= now) rateBuckets.delete(bucketKey);
      }
      while (rateBuckets.size > 10000) {
        const oldestKey = rateBuckets.keys().next().value;
        if (!oldestKey) break;
        rateBuckets.delete(oldestKey);
      }
    }
  }

  if (path === "/api/health" || isWebhook) { await next(); return; }
  return requireAuth(c, next);
});

app.get("/api/health", async (c) => {
  try {
    const sql = getSql(c.env);
    await sql`SELECT 1`;
    return c.json({ ok: true, db: true, time: new Date().toISOString() }, 200);
  } catch {
    return c.json({ ok: false, db: false }, 503);
  }
});

app.route("/api/crm", crmRoutes);
app.route("/api/supplier", supplierRoutes);
app.route("/api/katalog", katalogRoutes);
app.route("/api/aktivitas", aktivitasRoutes);
app.route("/api/cari", cariRoutes);
app.route("/api/pengingat", pengingatRoutes);
app.route("/api/kepatuhan", kepatuhanRoutes);
app.route("/api/kampanye", kampanyeRoutes);
app.route("/api/email", threadsRoutes);
app.route("/api/email", draftsRoutes);
app.route("/api/email", liveRoutes);
app.route("/api/whatsapp", whatsappRoutes);
app.route("/", webhookRoutes);
app.route("/", whatsappWebhookRoutes);

app.notFound(notFound);
app.onError(errorHandler);

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledController,
    env: Env,
    _context: ExecutionContext,
  ): Promise<void> {
    await runScheduledEmailSender(env);
  },
};

export { app };
