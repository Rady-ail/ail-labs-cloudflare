import { Hono } from "hono";
import type { Env } from "./env";
import type { AppEnv } from "./lib/http";
import { errorHandler, fail, newRequestId, notFound } from "./lib/http";
import { getSql } from "./lib/db";
import { requireAuth } from "./lib/auth";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("requestId", newRequestId());
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header("Cache-Control", "no-store");
  await next();
});

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== "https://app.ail-aesthetic-labs.my.id") {
    return fail(c, 403, "ORIGIN_FORBIDDEN", "Origin tidak diizinkan");
  }
  await next();
});

app.use("/api/*", requireAuth);

app.get("/api/health", async (c) => {
  try {
    const sql = getSql(c.env);
    await sql`SELECT 1 AS ok`;
    return c.json({ ok: true, db: true, time: new Date().toISOString() }, 200);
  } catch {
    return c.json({ ok: false, db: false, time: new Date().toISOString() }, 503);
  }
});

app.notFound(notFound);
app.onError(errorHandler);

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    // The scheduled sender is attached in the email module commit.
    ctx.waitUntil(Promise.resolve());
  },
};

export { app };
