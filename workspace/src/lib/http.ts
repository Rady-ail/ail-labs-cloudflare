import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../env";

export interface AppVariables {
  requestId: string;
  actor: string;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };

export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
  };
}

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Content-Security-Policy", "default-src 'none'");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
    await next();
  };
}

export function originGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !["GET", "HEAD"].includes(c.req.method) && origin !== "https://app.ail-aesthetic-labs.my.id") {
      return fail(c, 403, "ORIGIN_DENIED", "Origin tidak diizinkan");
    }
    await next();
  };
}

export function bodyLimit(maxBytes = 256 * 1024): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const contentLength = Number(c.req.header("Content-Length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return fail(c, 413, "BODY_TOO_LARGE", "Ukuran body melewati batas");
    }
    if (c.req.raw.body) {
      const reader = c.req.raw.clone().body?.getReader();
      if (reader) {
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            return fail(c, 413, "BODY_TOO_LARGE", "Ukuran body melewati batas");
          }
        }
      }
    }
    await next();
  };
}

export function ok<T>(c: Context<AppEnv>, data: T, meta: Record<string, unknown> = {}) {
  return c.json({ data, meta: { requestId: c.get("requestId"), ...meta } }, 200);
}

export function created<T>(c: Context<AppEnv>, data: T, meta: Record<string, unknown> = {}) {
  return c.json({ data, meta: { requestId: c.get("requestId"), ...meta } }, 201);
}

export function fail(c: Context<AppEnv>, status: number, code: string, message: string, details?: unknown) {
  return c.json({ error: { code, message, ...(details === undefined ? {} : { details }) }, meta: { requestId: c.get("requestId") } }, status as ContentfulStatusCode);
}

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  void error;
  return fail(c, 500, "INTERNAL_ERROR", "Terjadi kesalahan internal");
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  fail(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan");
