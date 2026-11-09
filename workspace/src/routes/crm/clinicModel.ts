import { ValidationError } from "../../lib/http";
import { isEmail, normalizePhoneId, pickAllowed } from "../../lib/validate";

export const STAGES = [
  "lead",
  "contacted",
  "catalog_sent",
  "negotiating",
  "ordered",
  "active",
  "inactive",
] as const;

export type ClinicStage = (typeof STAGES)[number];

const CREATE_FIELDS = [
  "name",
  "city",
  "province",
  "address",
  "stage",
  "interest",
  "tags",
  "pic_name",
  "pic_role",
  "phone",
  "email",
  "doctors_count",
  "services",
  "hours",
  "notes",
] as const;

const UPDATE_FIELDS = [
  "name",
  "city",
  "province",
  "address",
  "interest",
  "tags",
  "pic_name",
  "pic_role",
  "phone",
  "email",
  "doctors_count",
  "services",
  "hours",
  "notes",
] as const;

type ClinicInputMode = "create" | "update";
type ClinicInput = Record<string, unknown> & { tags?: string[] };

function asIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function rowToClinic(
  row: Record<string, any>,
  tags: string[] = [],
  contacts: Record<string, unknown>[] = [],
  activities: Record<string, unknown>[] = [],
) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    province: row.province,
    address: row.address ?? null,
    stage: row.stage,
    interest: row.interest ?? null,
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
    pic_name: row.pic_name ?? null,
    pic_role: row.pic_role ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    doctors_count: Number(row.doctors_count ?? 0),
    services: Array.isArray(row.services) ? row.services : [],
    hours: row.hours ?? null,
    next_followup_at: asIso(row.next_followup_at),
    next_followup_reason: row.next_followup_reason ?? null,
    last_contact_at: asIso(row.last_contact_at),
    interactions_count: Number(row.interactions_count ?? 0),
    orders_count: Number(row.orders_count ?? 0),
    notes: row.notes ?? "",
    archived: Boolean(row.archived),
    created_at: asIso(row.created_at),
    contacts,
    activities,
  };
}

export function validateClinicInput(body: Record<string, unknown>, mode: ClinicInputMode): ClinicInput {
  const allowed = mode === "create" ? CREATE_FIELDS : UPDATE_FIELDS;
  let picked: Partial<Record<string, unknown>>;
  try {
    picked = pickAllowed<Record<string, unknown>>(body, allowed);
  } catch (error) {
    if (error instanceof ValidationError) {
      const unknown = (error.details as { fields?: unknown } | undefined)?.fields;
      const fields: Record<string, string> = {};
      if (Array.isArray(unknown)) {
        for (const key of unknown) fields[String(key)] = "Field tidak dikenal.";
      }
      throw new ValidationError("BAD_REQUEST", "Field tidak dikenal.", { fields });
    }
    throw error;
  }

  const result: ClinicInput = {};
  const fields: Record<string, string> = {};
  let invalidCode = "VALIDATION_ERROR";

  const requiredString = (key: "name" | "city" | "province", label: string) => {
    const value = picked[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      fields[key] = `${label} wajib diisi.`;
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length > 120) fields[key] = `${label} maksimal 120 karakter.`;
    else result[key] = trimmed;
  };

  for (const [key, label] of [["name", "Nama klinik"], ["city", "Kota"], ["province", "Provinsi"]] as const) {
    if (mode === "create" || Object.prototype.hasOwnProperty.call(picked, key)) {
      requiredString(key, label);
    }
  }

  const maxStrings = [
    ["address", 300],
    ["notes", 2000],
    ["pic_name", 120],
    ["pic_role", 120],
    ["hours", 120],
  ] as const;
  for (const [key, max] of maxStrings) {
    if (!Object.prototype.hasOwnProperty.call(picked, key)) continue;
    const value = picked[key];
    if (value === null) {
      result[key] = null;
    } else if (typeof value !== "string") {
      fields[key] = "Harus berupa teks.";
    } else if (value.trim().length > max) {
      fields[key] = `Maksimal ${max} karakter.`;
    } else {
      result[key] = value.trim() || null;
    }
  }

  if (mode === "create") {
    const stage = picked.stage === undefined ? "lead" : picked.stage;
    if (typeof stage !== "string" || !STAGES.includes(stage as ClinicStage)) {
      fields.stage = "Tahap klinik tidak valid.";
      invalidCode = "INVALID_STAGE";
    } else result.stage = stage;
  }

  if (Object.prototype.hasOwnProperty.call(picked, "interest")) {
    const value = picked.interest;
    if (value === null || value === 1 || value === 2 || value === 3) result.interest = value;
    else {
      fields.interest = "Minat harus 1, 2, 3, atau null.";
      if (invalidCode === "VALIDATION_ERROR") invalidCode = "INVALID_INTEREST";
    }
  }

  if (Object.prototype.hasOwnProperty.call(picked, "phone")) {
    const value = picked.phone;
    if (value === null || (typeof value === "string" && value.trim() === "")) result.phone = null;
    else {
      const normalized = normalizePhoneId(value);
      if (normalized === null) {
        fields.phone = "Nomor WhatsApp Indonesia tidak valid.";
        if (invalidCode === "VALIDATION_ERROR") invalidCode = "INVALID_PHONE";
      } else result.phone = normalized;
    }
  }

  if (Object.prototype.hasOwnProperty.call(picked, "email")) {
    const value = picked.email;
    if (value === null || (typeof value === "string" && value.trim() === "")) result.email = null;
    else if (typeof value !== "string" || !isEmail(value.trim())) {
      fields.email = "Email tidak valid.";
      if (invalidCode === "VALIDATION_ERROR") invalidCode = "INVALID_EMAIL";
    } else result.email = value.trim().toLowerCase();
  }

  if (Object.prototype.hasOwnProperty.call(picked, "doctors_count")) {
    const value = picked.doctors_count;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1000) {
      fields.doctors_count = "Jumlah dokter harus berupa bilangan bulat 0–1000.";
    } else result.doctors_count = value;
  }

  for (const key of ["services", "tags"] as const) {
    if (!Object.prototype.hasOwnProperty.call(picked, key)) continue;
    const value = picked[key];
    const maxLength = key === "services" ? 80 : 40;
    if (!Array.isArray(value) || value.length > 20) {
      fields[key] = `${key === "services" ? "Layanan" : "Tag"} harus berupa array maksimal 20 item.`;
      continue;
    }
    const normalized: string[] = [];
    let invalid = false;
    for (const item of value) {
      if (typeof item !== "string" || item.trim().length < 1 || item.trim().length > maxLength) {
        invalid = true;
        break;
      }
      const text = item.trim();
      const finalValue = key === "tags" ? text.toLowerCase() : text;
      if (!normalized.includes(finalValue)) normalized.push(finalValue);
    }
    if (invalid) fields[key] = `Setiap item harus berupa teks 1–${maxLength} karakter.`;
    else result[key] = normalized;
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(invalidCode, "Data tidak valid.", { fields });
  }
  return result;
}
