import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../env";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    actor: string;
    requestId: string;
  };
};

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function fail(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
) {
  return c.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) }, meta: { requestId: c.get("requestId") } },
    status,
  );
}

export function errorHandler(error: Error, c: Context<AppEnv>) {
  if (error instanceof HTTPException) {
    return fail(c, error.status, "HTTP_ERROR", "Permintaan tidak dapat diproses");
  }
  console.error("Unhandled request error", { requestId: c.get("requestId"), name: error.name });
  return fail(c, 500, "INTERNAL_ERROR", "Terjadi kesalahan internal");
}

export function notFound(c: Context<AppEnv>) {
  return fail(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan");
}
