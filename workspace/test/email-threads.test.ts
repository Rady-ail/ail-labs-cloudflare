import { test, expect, describe } from "vitest";
import { neon } from "@neondatabase/serverless";
import { app } from "../src/index";

const runtime = (globalThis as any).process?.env ?? {};
const databaseUrl = runtime.DATABASE_URL as string | undefined;
const databaseName = databaseUrl ? (() => {
  try { return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")); }
  catch { return ""; }
})() : "";
const integrationAllowed = Boolean(
  databaseUrl && runtime.TEST_DATABASE_ALLOW_WRITE === "1" && /test/i.test(databaseName),
);
if (!integrationAllowed) {
  console.warn("[integration tests skipped] Set DATABASE_URL to a dedicated database whose name contains 'test' and TEST_DATABASE_ALLOW_WRITE=1.");
}
const sql = databaseUrl ? neon(databaseUrl) : null;
const env: any = {
  DATABASE_URL: databaseUrl ?? "postgres://unused:unused@127.0.0.1:1/unused",
  API_TOKEN: runtime.API_TOKEN ?? "email-test-token",
  EMAIL_SEND_MODE: "dry-run",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
};
const headers = { Authorization: `Bearer ${env.API_TOKEN}`, Origin: "https://app.ail-aesthetic-labs.my.id", "Content-Type": "application/json" };
const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);

describe.skipIf(!integrationAllowed)("Postgres write integration", () => {
test("thread detail, patch, archive, event log, and attachment metadata", async () => {
  const marker = `email-thread-test-${crypto.randomUUID()}`;
  const threadRows = await sql!`INSERT INTO email_threads (subject, folder, snippet, last_message_at)
    VALUES (${marker}, 'inbox', 'test snippet', now()) RETURNING id::text AS id`;
  const threadId = String(threadRows[0].id);
  let messageId = "";
  try {
    const messageRows = await sql!`INSERT INTO email_messages
      (thread_id, direction, from_email, subject, body_text, body_html, received_at)
      VALUES (${threadId}, 'inbound', 'sender@example.test', ${marker}, 'untrusted body', '<b>raw html</b>', now())
      RETURNING id::text AS id`;
    messageId = String(messageRows[0].id);
    await sql!`INSERT INTO email_attachments (message_id, filename, content_type, byte_size, storage_key)
      VALUES (${messageId}, 'brief.pdf', 'application/pdf', 123, 'private/storage/key')`;

    const detailResponse = await request(`/api/email/threads/${threadId}`, { headers });
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as any;
    expect(detail.data.thread.id).toBe(threadId);
    expect(detail.data.messages[0].id).toBe(messageId);
    expect(detail.data.messages[0]).not.toHaveProperty("bodyHtml");
    expect(detail.data.messages[0].attachments[0]).not.toHaveProperty("storage_key");
    expect(detail.data.messages[0].attachments[0].filename).toBe("brief.pdf");

    const patchResponse = await request(`/api/email/threads/${threadId}`, {
      method: "PATCH", headers, body: JSON.stringify({ isRead: true, isStarred: true }),
    });
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json() as any).data).toMatchObject({ isRead: true, isStarred: true });

    const archiveResponse = await request(`/api/email/threads/${threadId}/archive`, {
      method: "POST", headers, body: "{}",
    });
    expect(archiveResponse.status).toBe(200);
    expect((await archiveResponse.json() as any).data).toMatchObject({ id: threadId, isArchived: true });
    const repeatArchive = await request(`/api/email/threads/${threadId}/archive`, {
      method: "POST", headers, body: "{}",
    });
    expect(repeatArchive.status).toBe(200);

    const events = await sql!`SELECT event_type FROM email_events
      WHERE thread_id = ${threadId} ORDER BY id`;
    const types = events.map((row: any) => row.event_type);
    expect(types).toContain("thread_marked_read");
    expect(types).toContain("thread_marked_starred");
    expect(types.filter((type: string) => type === "thread_archived")).toHaveLength(1);
  } finally {
    await sql!`DELETE FROM email_events WHERE thread_id = ${threadId}`;
    await sql!`DELETE FROM email_threads WHERE id = ${threadId}`;
  }
});

test("thread list validates allowlists and returns BIGINT IDs as strings", async () => {
  const marker = `email-list-test-${crypto.randomUUID()}`;
  const inserted = await sql!`INSERT INTO email_threads (subject, folder, snippet, last_message_at)
    VALUES (${marker}, 'inbox', 'find-me', now()) RETURNING id::text AS id`;
  const threadId = String(inserted[0].id);
  const second = await sql!`INSERT INTO email_threads (subject, folder, snippet, last_message_at)
    VALUES (${marker}, 'inbox', 'find-me too', now()) RETURNING id::text AS id`;
  const secondId = String(second[0].id);
  try {
    const response = await request(`/api/email/threads?folder=inbox&q=${encodeURIComponent(marker)}&limit=1`, { headers });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data.total).toBe(2);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.nextCursor).toBeTruthy();
    expect([threadId, secondId]).toContain(body.data.items[0].id);
    expect(typeof body.data.items[0].id).toBe("string");
    expect(body.meta.requestId).toBeTruthy();

    const next = await request(`/api/email/threads?folder=inbox&q=${encodeURIComponent(marker)}&limit=1&cursor=${encodeURIComponent(body.data.nextCursor)}`, { headers });
    expect(next.status).toBe(200);
    const nextBody = await next.json() as any;
    expect(nextBody.data.items).toHaveLength(1);
    expect(nextBody.data.items[0].id).not.toBe(body.data.items[0].id);

    const badQuery = await request("/api/email/threads?unknown=x", { headers });
    expect(badQuery.status).toBe(400);
    expect((await badQuery.json() as any).error.code).toBe("BAD_REQUEST");
  } finally {
    await sql!`DELETE FROM email_threads WHERE id = ${threadId}`;
    await sql!`DELETE FROM email_threads WHERE id = ${secondId}`;
  }
});
});
