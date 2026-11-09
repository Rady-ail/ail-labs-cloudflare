import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { getSql } from "../../lib/db";

const webhookRoutes = new Hono<AppEnv>();
const MAX_BODY_BYTES = 1_048_576;
const TOLERANCE_SECONDS = 300;

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i % Math.max(left.length, 1)] ?? 0) ^ (right[i % Math.max(right.length, 1)] ?? 0);
  }
  return diff === 0;
}

async function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  signatureHeader: string,
  rawBody: string,
): Promise<boolean> {
  if (!secret.startsWith("whsec_") || !/^\d{1,12}$/.test(timestamp) || !id || !signatureHeader) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)
    || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > TOLERANCE_SECONDS) return false;

  const keyBytes = decodeBase64(secret.slice(6));
  if (!keyBytes?.length) return false;
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));

  for (const part of signatureHeader.split(" ")) {
    const [version, encoded] = part.split(",", 2);
    if (version !== "v1" || !encoded) continue;
    const candidate = decodeBase64(encoded);
    if (candidate && constantTimeEqual(expected, candidate)) return true;
  }
  return false;
}

function cleanText(value: unknown, max = 50_000): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max);
}

function address(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase().slice(0, 320);
}

function addresses(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map(address).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)).slice(0, 50);
}

function headerValue(headers: unknown, name: string): string | null {
  if (Array.isArray(headers)) {
    const found = headers.find((item) => item && typeof item === "object"
      && String((item as Record<string, unknown>).name ?? "").toLowerCase() === name.toLowerCase());
    const value = found && (found as Record<string, unknown>).value;
    return typeof value === "string" ? value : null;
  }
  if (headers && typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const key = Object.keys(record).find((item) => item.toLowerCase() === name.toLowerCase());
    const value = key ? record[key] : undefined;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function textFromHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return cleanText(value
    .replace(/<\s*(script|style|head)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>|<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n"));
}

function eventPayload(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

async function resolveReceivedData(env: AppEnv["Bindings"], data: Record<string, any>): Promise<Record<string, any>> {
  if ((typeof data.text === "string" && data.text.length)
    || (typeof data.html === "string" && data.html.length)
    || !env.RESEND_API_KEY || typeof data.email_id !== "string") return data;
  try {
    const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id)}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!response.ok) return data;
    const detail = eventPayload(await response.json());
    if (!detail) return data;
    return { ...data, ...detail, email_id: data.email_id ?? detail.id };
  } catch {
    return data;
  }
}

async function processReceived(sql: ReturnType<typeof getSql>, data: Record<string, any>): Promise<void> {
  const resendId = cleanText(data.email_id, 200);
  if (!resendId) return;

  const existing = await sql`SELECT id FROM email_messages WHERE resend_email_id = ${resendId} LIMIT 1`;
  if (existing.length) return;

  const from = address(data.from);
  const to = addresses(data.to);
  if (!from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) return;

  const headers = data.headers ?? {};
  const messageId = cleanText(data.message_id ?? headerValue(headers, "message-id"), 998) || null;
  const inReplyTo = cleanText(data.in_reply_to ?? headerValue(headers, "in-reply-to"), 998);
  const references = cleanText(data.references ?? headerValue(headers, "references"), 4000);
  const parentIds = [inReplyTo, ...references.split(/\s+/)].filter(Boolean).slice(0, 20);
  const subject = cleanText(data.subject, 300) || "(No subject)";
  const bodyText = cleanText(data.text, 50_000) || textFromHtml(data.html);
  const receivedAt = typeof data.created_at === "string" && !Number.isNaN(Date.parse(data.created_at))
    ? new Date(data.created_at).toISOString() : new Date().toISOString();

  const parent = parentIds.length
    ? await sql`SELECT thread_id::text AS thread_id FROM email_messages
        WHERE message_id = ANY(${parentIds}::text[]) ORDER BY created_at DESC LIMIT 1`
    : [];
  let threadId = parent[0]?.thread_id ? String(parent[0].thread_id) : null;
  if (!threadId) {
    const thread = await sql`INSERT INTO email_threads
        (subject, folder, snippet, last_message_at, created_at, updated_at)
      VALUES (${subject}, 'inbox', ${bodyText.slice(0, 240)}, ${receivedAt}::timestamptz,
        now(), now())
      RETURNING id::text AS id`;
    threadId = String(thread[0].id);
  }

  const inserted = await sql`INSERT INTO email_messages
      (thread_id, resend_email_id, message_id, direction, from_email, to_recipients,
       cc_recipients, bcc_recipients, subject, body_text, in_reply_to, references_header,
       received_at, headers, metadata)
    VALUES (${threadId}::bigint, ${resendId}, ${messageId}, 'inbound', ${from},
      ${JSON.stringify(to)}::jsonb, ${JSON.stringify(addresses(data.cc))}::jsonb,
      ${JSON.stringify(addresses(data.bcc))}::jsonb, ${subject}, ${bodyText},
      ${inReplyTo || null}, ${references || null}, ${receivedAt}::timestamptz,
      ${JSON.stringify({})}::jsonb,
      ${JSON.stringify({ provider: "resend", attachment_count: Array.isArray(data.attachments) ? data.attachments.length : 0 })}::jsonb)
    ON CONFLICT (resend_email_id) DO NOTHING
    RETURNING id::text AS id`;
  if (!inserted.length) return;

  const attachmentRows = Array.isArray(data.attachments) ? data.attachments.slice(0, 50) : [];
  for (const attachment of attachmentRows) {
    if (!attachment || typeof attachment !== "object") continue;
    const item = attachment as Record<string, unknown>;
    const filename = cleanText(item.filename, 255);
    if (!filename) continue;
    const size = Number(item.size ?? item.byte_size);
    await sql`INSERT INTO email_attachments
      (message_id, filename, content_type, byte_size, provider_attachment_id)
      VALUES (${inserted[0].id}::bigint, ${filename},
        ${cleanText(item.content_type ?? item.contentType, 160) || null},
        ${Number.isSafeInteger(size) && size >= 0 ? size : null},
        ${cleanText(item.id ?? item.attachment_id, 300) || null})`;
  }

  await sql`UPDATE email_threads SET last_message_at = ${receivedAt}::timestamptz,
      snippet = ${bodyText.slice(0, 240)}, folder = 'inbox', updated_at = now()
    WHERE id = ${threadId}::bigint`;
  await sql`INSERT INTO email_events (thread_id, event_type, actor, event_data)
    VALUES (${threadId}::bigint, 'message_received', 'resend_webhook',
      ${JSON.stringify({ resend_email_id: resendId, message_id: messageId })}::jsonb)`;
}

async function processStatus(sql: ReturnType<typeof getSql>, type: string, data: Record<string, any>): Promise<void> {
  const resendId = cleanText(data.email_id, 200);
  if (!resendId) return;
  const eventKey = `resend_${type.replace(/[^a-z0-9_]/gi, "_")}`;
  const rows = await sql`UPDATE email_messages
      SET metadata = metadata || jsonb_build_object('delivery_status', ${type}::text, ${eventKey}::text, ${JSON.stringify({
        occurred_at: cleanText(data.created_at, 80) || new Date().toISOString(),
      })}::jsonb)
      WHERE resend_email_id = ${resendId}
        AND NOT (metadata ? ${eventKey}::text)
      RETURNING id::text AS id, thread_id::text AS thread_id`;
  if (type === "email.bounced" || type === "email.complained") {
    const recipients = addresses(data.to ?? data.email?.to);
    for (const email of recipients) {
      await sql`INSERT INTO email_suppressions (email, reason, source)
        VALUES (${email}, ${type === "email.bounced" ? "bounce" : "complaint"}, 'resend_webhook')
        ON CONFLICT (lower(email)) DO UPDATE SET
          reason = EXCLUDED.reason, source = EXCLUDED.source`;
    }
  }
  if (!rows.length) return;
  await sql`INSERT INTO email_events (thread_id, event_type, actor, event_data)
    VALUES (${rows[0].thread_id}::bigint, ${eventKey}, 'resend_webhook',
      ${JSON.stringify({ resend_email_id: resendId })}::jsonb)`;
}

webhookRoutes.post("/api/webhooks/resend", async (c) => {
  const secret = c.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !secret.startsWith("whsec_")) {
    return c.json({ error: "Webhook unavailable" }, 503);
  }

  const declaredLength = Number(c.req.header("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return c.json({ error: "Payload too large" }, 413);
  }

  const id = c.req.header("svix-id") ?? "";
  const timestamp = c.req.header("svix-timestamp") ?? "";
  const signature = c.req.header("svix-signature") ?? "";
  const rawBytes = await readBoundedBody(c.req.raw, MAX_BODY_BYTES);
  if (!rawBytes) return c.json({ error: "Payload too large" }, 413);
  const rawBody = new TextDecoder().decode(rawBytes);

  let valid = false;
  try {
    valid = await verifySvix(secret, id, timestamp, signature, rawBody);
  } catch {
    valid = false;
  }
  if (!valid) return c.json({ error: "Invalid webhook" }, 401);

  let parsed: Record<string, any> | null = null;
  try {
    parsed = eventPayload(JSON.parse(rawBody));
  } catch {
    return c.json({ error: "Invalid webhook" }, 401);
  }
  if (!parsed || typeof parsed.type !== "string") return c.json({ received: true }, 200);

  try {
    const sql = getSql(c.env);
    if (parsed.type === "email.received") {
      await processReceived(sql, await resolveReceivedData(c.env, eventPayload(parsed.data) ?? {}));
    } else if (parsed.type.startsWith("email.")) {
      await processStatus(sql, parsed.type, eventPayload(parsed.data) ?? {});
    }
    return c.json({ received: true }, 200);
  } catch {
    return c.json({ error: "Webhook processing unavailable" }, 503);
  }
});

export { webhookRoutes };
