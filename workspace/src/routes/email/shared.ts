import type { Context } from "hono";
import type { AppEnv } from "../../lib/http";
import { ValidationError } from "../../lib/http";
import { isEmail } from "../../lib/validate";
import { readJsonObject } from "../../lib/body";

export type EmailSql = ReturnType<typeof import("../../lib/db").getSql>;

export function badRequest(message: string, details?: unknown): never {
  throw new ValidationError("BAD_REQUEST", message, details);
}

export function invalid(message: string, details?: unknown): never {
  throw new ValidationError("INVALID_EMAIL_INPUT", message, details);
}

export function assertAllowedKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) badRequest("Field tidak dikenal", { fields: unknown });
}

export function assertQueryKeys(query: Record<string, string>, allowed: readonly string[]): void {
  const unknown = Object.keys(query).filter((key) => !allowed.includes(key));
  if (unknown.length) badRequest("Parameter tidak dikenal", { fields: unknown });
}

export function parseBigintId(value: string, label = "ID"): string {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) badRequest(`${label} tidak valid`);
  return value;
}

export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function escapeLike(value: string): string {
  return value.replace(/[\\\\%_]/g, (character) => `\\\\${character}`);
}

export function parseRecipients(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(`${field} harus berupa array email`, { field });
  const result: string[] = [];
  for (const recipient of value) {
    if (typeof recipient !== "string" || !isEmail(recipient.trim())) {
      invalid(`Alamat email pada ${field} tidak valid`, { field });
    }
    result.push(recipient.trim());
  }
  return result;
}

export function validateDraftFields(body: Record<string, unknown>, partial = false) {
  const allowed = ["subject", "to", "cc", "bcc", "bodyText"];
  assertAllowedKeys(body, partial ? allowed : [...allowed, "threadId"]);
  const result: {
    subject?: string; to?: string[]; cc?: string[]; bcc?: string[]; bodyText?: string; threadId?: string | null;
  } = {};

  if (!partial || Object.hasOwn(body, "subject")) {
    if (typeof body.subject !== "string" || body.subject.length > 300) {
      invalid("Subject wajib berupa teks maksimal 300 karakter", { field: "subject" });
    }
    result.subject = body.subject;
  }
  for (const [key, target] of [["to", "to"], ["cc", "cc"], ["bcc", "bcc"]] as const) {
    if (!partial || Object.hasOwn(body, key)) result[target] = parseRecipients(body[key], key);
  }
  if (!partial || Object.hasOwn(body, "bodyText")) {
    if (typeof body.bodyText !== "string" || body.bodyText.length > 50000) {
      invalid("bodyText wajib berupa teks maksimal 50.000 karakter", { field: "bodyText" });
    }
    result.bodyText = body.bodyText;
  }
  if (!partial && Object.hasOwn(body, "threadId")) {
    if (body.threadId === null) result.threadId = null;
    else if (typeof body.threadId === "string") result.threadId = parseBigintId(body.threadId, "threadId");
    else invalid("threadId harus berupa ID string atau null", { field: "threadId" });
  }
  const total = (result.to?.length ?? 0) + (result.cc?.length ?? 0) + (result.bcc?.length ?? 0);
  if (total > 50) invalid("Maksimal 50 penerima gabungan", { field: "recipients" });
  return result;
}

export function encodeCursor(lastAt: string, id: string): string {
  const raw = JSON.stringify({ at: lastAt, id });
  return btoa(raw).split("+").join("-").split("/").join("_").replace(/=+$/g, "");
}

export function decodeCursor(value: string | undefined): { at: string; id: string } | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const parsed = JSON.parse(raw) as { at?: unknown; id?: unknown };
    if (typeof parsed.at !== "string" || Number.isNaN(Date.parse(parsed.at))) badRequest("Cursor tidak valid");
    if (typeof parsed.id !== "string") badRequest("Cursor tidak valid");
    return { at: new Date(parsed.at).toISOString(), id: parseBigintId(parsed.id, "Cursor ID") };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    badRequest("Cursor tidak valid");
  }
}

export async function readOptionalJsonObject(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  return c.req.raw.body ? await readJsonObject(c) : {};
}

export async function insertEmailEvent(
  sql: EmailSql,
  input: { threadId?: string | null; draftId?: string | null; eventType: string; actor?: string | null; eventData?: Record<string, unknown> },
): Promise<void> {
  await sql`INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
    VALUES (${input.threadId ?? null}, ${input.draftId ?? null}, ${input.eventType},
      ${input.actor ?? null}, ${JSON.stringify(input.eventData ?? {})}::jsonb)`;
}

export function actor(c: Context<AppEnv>): string {
  return c.get("actor");
}

export function jsonString(value: unknown): string {
  return JSON.stringify(value ?? []);
}
