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

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("requestId", newRequestId());
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Content-Security-Policy", "default-src 'none'");
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  await next();
});

app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  const path = c.req.path;

  if (
    !path.startsWith("/api/crm/") &&
    (method === "POST" || method === "PATCH" || method === "PUT")
  ) {
    const contentLengthHeader = c.req.header("Content-Length");
    if (contentLengthHeader !== undefined) {
      const contentLength = Number(contentLengthHeader);
      const limit = path === "/api/webhooks/resend" ? 1048576 : 262144;
      if (Number.isFinite(contentLength) && contentLength > limit) {
        return fail(c, 413, "PAYLOAD_TOO_LARGE", "Ukuran payload terlalu besar");
      }
    }
  }

  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (origin !== undefined && origin !== "https://app.ail-aesthetic-labs.my.id") {
      return fail(c, 403, "FORBIDDEN", "Origin tidak diizinkan");
    }
  }

  if (path === "/api/health" || path === "/api/webhooks/resend") {
    await next();
    return;
  }

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
    _env: Env,
    _context: ExecutionContext,
  ): Promise<void> {
    return Promise.resolve();
  },
};

export { app };
