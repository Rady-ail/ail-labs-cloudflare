import type { Context } from "hono";
import type { AppEnv } from "./http";
import { ValidationError } from "./http";

export async function readJsonObject(
  c: Context<AppEnv>,
  maxBytes = 262144,
): Promise<Record<string, unknown>> {
  const stream = c.req.raw.body;
  if (!stream) {
    throw new ValidationError("BAD_REQUEST", "Body harus berupa objek JSON");
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ValidationError("PAYLOAD_TOO_LARGE", "Ukuran payload terlalu besar");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON body must be an object");
    }
    const prototype = Object.getPrototypeOf(parsed);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("JSON body must be a plain object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError("BAD_REQUEST", "Body harus berupa objek JSON");
  }
}
