import { Hono } from "hono";
import type { WorkerBindings } from "./env";
import type { AppEnv } from "./lib/http";
import { authMiddleware } from "./lib/auth";
import { bodyLimit, errorHandler, notFound, originGuard, requestId, securityHeaders } from "./lib/http";
import health from "./routes/health";

const api = new Hono<AppEnv>();
api.route("/health", health);

const app = new Hono<AppEnv>();
app.use("*", requestId());
app.use("*", securityHeaders());
app.use("*", originGuard());
app.use("/api/*", bodyLimit(256 * 1024));
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path === "/api/email/webhook/resend") return next();
  return authMiddleware(c, next);
});
app.route("/api", api);
app.notFound(notFound);
app.onError(errorHandler);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, _env: WorkerBindings, _context: ExecutionContext): Promise<void> {
    return Promise.resolve();
  },
};

export { app };
