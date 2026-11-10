import type { Context } from "hono";
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
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return c.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) }, meta: { requestId: c.get("requestId") } },
    status as 400,
  );
}

export function errorHandler(error: Error, c: Context<AppEnv>) {
  // Never expose stack traces or provider/database error details.
  return fail(c, 500, "INTERNAL_ERROR", "Terjadi kesalahan internal");
}

export function notFound(c: Context<AppEnv>) {
  return fail(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan");
}
