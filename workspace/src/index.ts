import { Hono } from "hono";
import type { Env } from "./env";
import type { AppEnv } from "./lib/http";
import { errorHandler, notFound, newRequestId } from "./lib/http";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("requestId", newRequestId());
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Content-Security-Policy", "default-src 'none'");
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true, db: null }));

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
