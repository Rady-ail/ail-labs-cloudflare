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
const headers = { Authorization: `Bearer ${env.API_TOKEN}` };
const request = (path: string) => app.request(path, { headers }, env);

describe.skipIf(!integrationAllowed)("Postgres write integration", () => {
test("live status exposes no credentials and new-count returns inbound message IDs", async () => {
  const marker = `email-live-test-${crypto.randomUUID()}`;
  const since = new Date(Date.now() - 5000).toISOString();
  const threadRows = await sql!`INSERT INTO email_threads (subject, folder) VALUES (${marker}, 'inbox') RETURNING id::text AS id`;
  const threadId = String(threadRows[0].id);
  try {
    const messageRows = await sql!`INSERT INTO email_messages
      (thread_id, direction, from_email, subject, body_text, received_at)
      VALUES (${threadId}, 'inbound', 'live@example.test', ${marker}, 'new message', now())
      RETURNING id::text AS id`;
    const messageId = String(messageRows[0].id);

    const status = await request("/api/email/live/status");
    expect(status.status).toBe(200);
    const statusBody = await status.json() as any;
    expect(statusBody.data).toMatchObject({ database: "online", emailSending: "disabled", provider: "none" });
    expect(JSON.stringify(statusBody)).not.toMatch(/api[_-]?key|secret|password/i);

    const count = await request(`/api/email/live/new-count?since=${encodeURIComponent(since)}`);
    expect(count.status).toBe(200);
    const countBody = await count.json() as any;
    expect(countBody.data.ids).toContain(messageId);
    expect(countBody.data.count).toBeGreaterThanOrEqual(1);
  } finally {
    await sql!`DELETE FROM email_threads WHERE id = ${threadId}`;
  }
});
});

test("live new-count rejects missing or malformed since", async () => {
  expect((await request("/api/email/live/new-count")).status).toBe(400);
  expect((await request("/api/email/live/new-count?since=yesterday")).status).toBe(400);
});
