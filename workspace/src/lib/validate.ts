const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_PATTERN = /^628[1-9][0-9]{7,11}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_PATTERN.test(value);
}

export function normalizePhoneId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let phone = value.trim();
  phone = phone.replace(/[\s()-]/g, "");
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (phone.startsWith("0062")) phone = `62${phone.slice(4)}`;
  else if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  else if (phone.startsWith("8")) phone = `62${phone}`;
  if (!PHONE_PATTERN.test(phone)) return null;
  return phone;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function pickAllowed<T extends Record<string, unknown>>(
  body: Record<string, unknown>,
  allowedKeys: readonly string[],
): Partial<T> {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) throw new TypeError(`Unknown fields: ${unknownKeys.jsoin(", ")}`);
  return body as Partial<T>;
}
