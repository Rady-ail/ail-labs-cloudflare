import { z } from "zod";
import { ValidationError } from "../../lib/http";

export const SUPPLIER_CATEGORIES = [
  "skincare_oem",
  "raw_material",
  "device_microneedling",
  "filler",
  "alkes",
  "aesthetic_wholesale",
  "kosmetik_brand",
  "led_device",
  "suplemen",
  "other",
] as const;

export const SUPPLIER_STATUSES = [
  "kandidat",
  "menunggu_balasan",
  "sampel_berjalan",
  "menunggu_dokumen",
  "menunggu_izin",
  "menunggu_pembayaran",
  "hold",
  "ditolak_supplier",
  "ditutup",
] as const;

export const SAMPLE_STATES = [
  "diminta",
  "disepakati",
  "dikirim",
  "diterima",
  "diuji",
  "ditolak",
] as const;

const slugSchema = z.string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === value;
  });

export const supplierCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(160),
  country: nullableText(100),
  contact: nullableText(120),
  channel: nullableText(120),
  category: z.enum(SUPPLIER_CATEGORIES),
  status: z.enum(SUPPLIER_STATUSES).default("kandidat"),
  terms: nullableText(2000),
  note: nullableText(4000),
  last_activity_on: dateSchema.nullable().optional(),
}).strict();

export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .extend({
    slug: slugSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const sampleCreateSchema = z.object({
  description: z.string().trim().min(1).max(500),
  state: z.enum(SAMPLE_STATES).default("diminta"),
  awb: nullableText(150),
  courier: nullableText(100),
  eta: dateSchema.nullable().optional(),
  note: nullableText(2000),
}).strict();

export const sampleUpdateSchema = sampleCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const importSchema = z.object({
  items: z.array(z.unknown()).min(1).max(200),
}).strict();

export type SupplierCreate = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdate = z.infer<typeof supplierUpdateSchema>;
export type SampleCreate = z.infer<typeof sampleCreateSchema>;
export type SampleUpdate = z.infer<typeof sampleUpdateSchema>;

function unsafeText(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const normalized = value.toLowerCase();

  if (normalized.includes("yolanda yue")) return true;
  if (normalized.includes("liyin biotech")) return true;

  // String yang menyerupai token atau credential.
  if (/\b(sk-[a-z0-9_-]{12,}|ghp_[a-z0-9]{20,})\b/i.test(value)) {
    return true;
  }

  return false;
}

export function assertSafeSupplier(
  input: Record<string, unknown>,
): void {
  for (const key of [
    "name",
    "country",
    "contact",
    "channel",
    "terms",
    "note",
    "description",
  ]) {
    if (unsafeText(input[key])) {
      throw new ValidationError(
        "VALIDATION_ERROR",
        "Data mengandung informasi yang tidak diizinkan.",
        { fields: { [key]: "Gunakan informasi bisnis non-pribadi." } },
      );
    }
  }
}

export function parseSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    const fields: Record<string, string> = {};

    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "body");
      fields[key] ??= "Data tidak valid.";
    }

    throw new ValidationError(
      "VALIDATION_ERROR",
      "Data supplier tidak valid.",
      { fields },
    );
  }

  return result.data;
}

export function validateSupplierCreate(input: unknown): SupplierCreate {
  const result = parseSchema(supplierCreateSchema, input);
  assertSafeSupplier(result as Record<string, unknown>);
  return result;
}

export function validateSupplierUpdate(input: unknown): SupplierUpdate {
  const result = parseSchema(supplierUpdateSchema, input);
  assertSafeSupplier(result as Record<string, unknown>);
  return result;
}

export function validateSampleCreate(input: unknown): SampleCreate {
  const result = parseSchema(sampleCreateSchema, input);
  assertSafeSupplier(result as Record<string, unknown>);
  return result;
}

export function validateSampleUpdate(input: unknown): SampleUpdate {
  const result = parseSchema(sampleUpdateSchema, input);
  assertSafeSupplier(result as Record<string, unknown>);
  return result;
}

export function isSupplierSlugBlocked(slug: string): boolean {
  return slug.trim().toLowerCase().startsWith("liyin");
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
