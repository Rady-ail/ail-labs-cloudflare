import { Hono } from "hono";
import type { Env } from "./env";
import type { AppEnv } from "./lib/http";
import { errorHandler, notFound, newRequestId, fail } from "./lib/http";
import { getSql } from "./lib/db";
import { requireAuth } from "./lib/auth";
import { crmRoutes } from "./routes/crm/clinics";
import { threadsRoutes } from "./routes/email/threads";
import { draftsRoutes } from "./routes/email/drafts";
import { liveRoutes } from "./routes/email/live";
import { webhookRoutes } from "./routes/email/webhook";
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
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
  const isWebhook = path === "/api/webhooks/resend";

  if (!isWebhook && method !== "GET" && method !== "HEAD" && !path.startsWith("/api/crm/")) {
    if (c.req.raw.body) {
      const actualBytes = await c.req.raw.clone().arrayBuffer();
      if (actualBytes.byteLength > 262144) {
        return fail(c, 413, "PAYLOAD_TOO_LARGE", "Ukuran payload terlalu besar");
      }
    }
  }

  if (!isWebhook && method !== "GET") {
    const origin = c.req.header("Origin");
    if (!isAllowedOrigin(origin, c.env.DEV === "1")) {
      return fail(c, 403, "FORBIDDEN", "Origin tidak diizinkan");
    }
  }

  if (!isWebhook) {
    const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
    const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
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
      for (const [bucketKey, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(bucketKey);
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
app.route("/api/email", threadsRoutes);
app.route("/api/email", draftsRoutes);
app.route("/api/email", liveRoutes);
app.route("/", webhookRoutes);

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
