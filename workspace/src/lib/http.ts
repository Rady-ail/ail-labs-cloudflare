import type { Context, ErrorHandler, NotFoundHandler } from "hono";

export interface AppVariables {
  requestId: string;
  actor: string;
}

export type AppEnv = {
  Bindings: import("../env").Env;
  Variables: AppVariables;
};

export class ValidationError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ValidationError";
  }
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function ok<T>(c: Context<AppEnv>, data: T, meta: Record<string, unknown> = {}) {
  return c.json({ data, meta: { requestId: c.get("requestId"), ...meta } }, 200);
}

export function created<T>(c: Context<AppEnv>, data: T, meta: Record<string, unknown> = {}) {
  return c.json({ data, meta: { requestId: c.get("requestId"), ...meta } }, 201);
}

export function fail(
  c: Context<AppEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500,
  code: string,
  message: string,
  details?: unknown,
) {
  return c.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) }, meta: { requestId: c.get("requestId") } },
    status,
  );
}

function crmError(
  c: Context<AppEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500,
  code: string,
  message: string,
  fields?: Record<string, string>,
) {
  return c.json(
    { error: { code, message, ...(fields ? { fields } : {}), request_id: c.get("requestId") } },
    status,
  );
}

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  const isCrm = c.req.path === "/api/crm" || c.req.path.startsWith("/api/crm/");
  if (error instanceof ValidationError) {
    if (isCrm) {
      const details = error.details as { fields?: Record<string, string> } | undefined;
      const status = error.code === "PAYLOAD_TOO_LARGE" ? 413
        : error.code === "BAD_REQUEST" ? 400
        : error.code.startsWith("INVALID_") || error.code === "VALIDATION_ERROR" ? 422
        : 400;
      return crmError(c, status, error.code, error.message, details?.fields);
    }
    const status = error.code === "PAYLOAD_TOO_LARGE" ? 413 : 400;
    return fail(c, status, error.code, error.message, error.details);
  }
  if (isCrm) return crmError(c, 500, "INTERNAL_ERROR", "Terjadi kesalahan internal");
  return fail(c, 500, "INTERNAL_ERROR", "Terjadi kesalahan internal");
};

export const notFound: NotFoundHandler<AppEnv> = (c) => {
  if (c.req.path === "/api/crm" || c.req.path.startsWith("/api/crm/")) {
    return crmError(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan");
  }
  return fail(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan");
};
