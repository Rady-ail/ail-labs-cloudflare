import { test, expect } from "vitest";
import { app } from "../src/index";

const secretBytes = new Uint8Array(32).map((_, index) => index + 1);
const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`;
const env: any = {
  DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
  API_TOKEN: "webhook-test-token",
  EMAIL_SEND_MODE: "dry-run",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: secret,
};

async function signedHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const id = `msg_${crypto.randomUUID()}`;
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  ));
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${btoa(String.fromCharCode(...signature))}`,
    "Content-Type": "application/json",
  };
}

test("Resend webhook returns 503 when its signing secret is not configured", async () => {
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    body: "{}",
  }, { ...env, RESEND_WEBHOOK_SECRET: "" });
  expect(response.status).toBe(503);
});

test("Resend webhook rejects a stale Svix timestamp", async () => {
  const body = JSON.stringify({ type: "email.unknown", data: {} });
  const timestamp = String(Math.floor(Date.now() / 1000) - 301);
  const headers = await signedHeaders(body, timestamp);
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  }, env);
  expect(response.status).toBe(401);
});

test("Resend webhook rejects an invalid signature", async () => {
  const body = JSON.stringify({ type: "email.unknown", data: {} });
  const headers = await signedHeaders(body);
  headers["svix-signature"] = "v1,ZmFrZQ==";
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  }, env);
  expect(response.status).toBe(401);
});

test("Resend webhook enforces the raw-body size limit", async () => {
  const body = "x".repeat(1_048_577);
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    body,
  }, env);
  expect(response.status).toBe(413);
});

test("Resend webhook accepts a correctly signed event envelope", async () => {
  const body = JSON.stringify({ type: "email.unknown", data: {} });
  const headers = await signedHeaders(body);
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  }, env);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ received: true });
});

import { neon } from "@neondatabase/serverless";

const runtime = (globalThis as any).process?.env ?? {};
const databaseUrl = runtime.DATABASE_URL as string | undefined;
if (!databaseUrl) throw new Error("DATABASE_URL is required for email webhook integration tests");
const integration = test;

integration("signed received event is deduplicated and stores sanitized attachment metadata", async () => {
  const sql = neon(databaseUrl!);
  const resendId = `webhook-test-${crypto.randomUUID()}`;
  const body = JSON.stringify({
    type: "email.received",
    data: {
      email_id: resendId,
      from: "Clinic Sender <clinic@example.test>",
      to: ["alexa@ail-aesthetic-labs.my.id"],
      subject: "Inbound test",
      text: "Hello\u0001 clinic",
      message_id: `<${crypto.randomUUID()}@example.test>`,
      attachments: [{ id: "att-test", filename: "brief.pdf", content_type: "application/pdf", size: 128 }],
    },
  });
  const headers = await signedHeaders(body);
  const requestEnv = { ...env, DATABASE_URL: databaseUrl! };

  try {
    const first = await app.request("/api/webhooks/resend", { method: "POST", headers, body }, requestEnv);
    expect(first.status).toBe(200);
    const secondHeaders = await signedHeaders(body);
    const second = await app.request("/api/webhooks/resend", {
      method: "POST", headers: secondHeaders, body,
    }, requestEnv);
    expect(second.status).toBe(200);

    const rows = await sql`SELECT id::text AS id, thread_id::text AS thread_id, body_text
      FROM email_messages WHERE resend_email_id = ${resendId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].body_text).toBe("Hello clinic");

    const attachments = await sql`SELECT filename, content_type, byte_size, provider_attachment_id
      FROM email_attachments WHERE message_id = ${rows[0].id}::bigint`;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      filename: "brief.pdf",
      content_type: "application/pdf",
      byte_size: 128,
      provider_attachment_id: "att-test",
    });
  } finally {
    const rows = await sql`SELECT id::text AS id, thread_id::text AS thread_id
      FROM email_messages WHERE resend_email_id = ${resendId}`;
    if (rows[0]) {
      await sql`DELETE FROM email_events WHERE thread_id = ${rows[0].thread_id}::bigint`;
      await sql`DELETE FROM email_threads WHERE id = ${rows[0].thread_id}::bigint`;
    }
  }
});


integration("delivery status is idempotent and bounce creates suppression", async () => {
  const sql = neon(databaseUrl!);
  const suffix = crypto.randomUUID();
  const deliveredId = `webhook-delivered-${suffix}`;
  const bouncedId = `webhook-bounced-${suffix}`;
  const recipient = `bounce-${suffix}@example.test`;
  const threadRows = await sql`INSERT INTO email_threads
    (subject, folder, snippet, last_message_at, created_at, updated_at)
    VALUES ('Webhook status test', 'sent', '', now(), now(), now())
    RETURNING id::text AS id`;
  const threadId = String(threadRows[0].id);
  try {
    for (const resendId of [deliveredId, bouncedId]) {
      await sql`INSERT INTO email_messages
        (thread_id, resend_email_id, direction, from_email, to_recipients, subject, body_text, sent_at, metadata)
        VALUES (${threadId}::bigint, ${resendId}, 'outbound', 'alexa@ail-aesthetic-labs.my.id',
          ${JSON.stringify([recipient])}::jsonb, 'Status test', 'body', now(), '{}'::jsonb)`;
    }
    const sendEvent = async (type: string, resendId: string) => {
      const body = JSON.stringify({ type, data: { email_id: resendId, to: [recipient] } });
      const headers = await signedHeaders(body);
      return app.request("/api/webhooks/resend", { method: "POST", headers, body },
        { ...env, DATABASE_URL: databaseUrl! });
    };

    expect((await sendEvent("email.delivered", deliveredId)).status).toBe(200);
    expect((await sendEvent("email.delivered", deliveredId)).status).toBe(200);
    const delivered = await sql`SELECT metadata FROM email_messages WHERE resend_email_id = ${deliveredId}`;
    expect(delivered[0].metadata?.resend_email_delivered).toBeTruthy();
    const deliveredEvents = await sql`SELECT id FROM email_events
      WHERE thread_id = ${threadId}::bigint AND event_type = 'resend_email_delivered'`;
    expect(deliveredEvents).toHaveLength(1);

    expect((await sendEvent("email.bounced", bouncedId)).status).toBe(200);
    expect((await sendEvent("email.bounced", bouncedId)).status).toBe(200);
    const suppression = await sql`SELECT email, reason FROM email_suppressions WHERE lower(email) = ${recipient}`;
    expect(suppression).toHaveLength(1);
    expect(suppression[0].reason).toBe("bounce");
  } finally {
    await sql`DELETE FROM email_suppressions WHERE lower(email) = ${recipient}`;
    await sql`DELETE FROM email_events WHERE thread_id = ${threadId}::bigint`;
    await sql`DELETE FROM email_threads WHERE id = ${threadId}::bigint`;
  }
});

integration("received event falls back to normalized subject and matching sender", async () => {
  const sql = neon(databaseUrl!);
  const suffix = crypto.randomUUID();
  const resendId = `webhook-thread-fallback-${suffix}`;
  const sender = `same-sender-${suffix}@example.test`;
  const threadRows = await sql`INSERT INTO email_threads
    (subject, folder, snippet, last_message_at, created_at, updated_at)
    VALUES ('Quarterly Skin Update', 'inbox', 'existing', now(), now(), now())
    RETURNING id::text AS id`;
  const threadId = String(threadRows[0].id);
  try {
    await sql`INSERT INTO email_messages
      (thread_id, resend_email_id, direction, from_email, to_recipients, subject, body_text,
       received_at, headers, metadata)
      VALUES (${threadId}::bigint, ${`seed-${resendId}`}, 'inbound', ${sender},
        '[]'::jsonb, 'Quarterly Skin Update', 'previous', now(), '{}'::jsonb, '{}'::jsonb)`;
    const body = JSON.stringify({
      type: "email.received",
      data: {
        email_id: resendId,
        from: sender,
        to: ["alexa@ail-aesthetic-labs.my.id"],
        subject: "Re: FWD: quarterly skin update",
        text: "follow-up without matching message-id",
      },
    });
    const headers = await signedHeaders(body);
    const response = await app.request("/api/webhooks/resend", {
      method: "POST", headers, body,
    }, { ...env, DATABASE_URL: databaseUrl! });
    expect(response.status).toBe(200);
    const received = await sql`SELECT thread_id::text AS thread_id FROM email_messages
      WHERE resend_email_id = ${resendId}`;
    expect(received).toHaveLength(1);
    expect(received[0].thread_id).toBe(threadId);
  } finally {
    await sql`DELETE FROM email_events WHERE thread_id = ${threadId}::bigint`;
    await sql`DELETE FROM email_messages WHERE thread_id = ${threadId}::bigint`;
    await sql`DELETE FROM email_threads WHERE id = ${threadId}::bigint`;
  }
});
