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

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof ValidationError) {
    return fail(c, 400, error.code, error.message, error.details);
  }
  return fail(c, 500, "INTERNAL_ERROR", "Terjadi kesalahan internal");
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  fail(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan");
