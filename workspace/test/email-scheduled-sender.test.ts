import { test, expect, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { runScheduledEmailSender } from "../src/jobs/scheduled-email-sender";

const runtime = (globalThis as any).process?.env ?? {};
const databaseUrl = runtime.DATABASE_URL as string | undefined;
if (!databaseUrl) throw new Error("DATABASE_URL is required for scheduled sender integration tests");
const integration = test;

integration("scheduled sender claims at most 10 due drafts and defaults to dry-run", async () => {
  const sql = neon(databaseUrl!);
  const marker = `scheduled-sender-test-${crypto.randomUUID()}`;
  const ids: string[] = [];

  try {
    for (let index = 0; index < 11; index += 1) {
      const rows = await sql`INSERT INTO email_drafts
        (subject, to_recipients, cc_recipients, bcc_recipients, body_text,
         status, scheduled_at, metadata)
        VALUES (
          ${marker + "-" + index},
          ${JSON.stringify(["recipient@example.test"])}::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          'dry-run test body',
          'scheduled',
          now() - interval '1 minute',
          ${JSON.stringify({ job_id: crypto.randomUUID() })}::jsonb
        )
        RETURNING id::text AS id`;
      ids.push(String(rows[0].id));
    }

    await runScheduledEmailSender({
      DATABASE_URL: databaseUrl!,
      API_TOKEN: "sender-test-token",
      RESEND_API_KEY: "",
      RESEND_WEBHOOK_SECRET: "",
      EMAIL_SEND_MODE: "dry-run",
    });

    const results = await sql`SELECT id::text AS id, status, metadata
      FROM email_drafts
      WHERE id = ANY(${ids}::bigint[])
      ORDER BY id`;
    const dryRunRows = results.filter((row: any) => row.status === "sent" && row.metadata?.dry_run === true);
    const pendingRows = results.filter((row: any) => row.status === "scheduled");

    expect(results).toHaveLength(11);
    expect(dryRunRows).toHaveLength(10);
    expect(pendingRows).toHaveLength(1);
  } finally {
    await sql`DELETE FROM email_events WHERE draft_id = ANY(${ids}::bigint[])`;
    await sql`DELETE FROM email_drafts WHERE id = ANY(${ids}::bigint[])`;
  }
});


function stubResendResponse(status: number, payload: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).startsWith("https://api.resend.com/")) {
      return new Response(JSON.stringify(payload), { status });
    }
    return originalFetch(...args);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function createScheduledDraft(sql: any, marker: string) {
  const rows = await sql`INSERT INTO email_drafts
    (subject, to_recipients, cc_recipients, bcc_recipients, body_text, status, scheduled_at, metadata)
    VALUES (${marker}, '["recipient@example.test"]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'sender integration body', 'scheduled', now() - interval '1 minute',
      ${JSON.stringify({ job_id: `job-${crypto.randomUUID()}` })}::jsonb)
    RETURNING id::text AS id`;
  return String(rows[0].id);
}

integration("live sender records a successful mocked Resend response", async () => {
  const sql = neon(databaseUrl!);
  const marker = `sender-live-success-${crypto.randomUUID()}`;
  const id = await createScheduledDraft(sql, marker);
  const resendId = `resend-${crypto.randomUUID()}`;
  const fetchMock = stubResendResponse(200, { id: resendId });
  try {
    await runScheduledEmailSender({
      DATABASE_URL: databaseUrl!, API_TOKEN: "sender-test-token",
      RESEND_API_KEY: "test-resend-key", RESEND_WEBHOOK_SECRET: "",
      EMAIL_SEND_MODE: "live",
    });
    const rows = (await sql`SELECT status, sent_message_id::text AS sent_message_id
      FROM email_drafts WHERE id = ${id}::bigint`) as Array<Record<string, any>>;
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sent_message_id).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const messages = await sql`SELECT id FROM email_messages WHERE resend_email_id = ${resendId}`;
    expect(messages).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    await sql`DELETE FROM email_events WHERE draft_id = ${id}::bigint`;
    await sql`DELETE FROM email_messages WHERE resend_email_id = ${resendId}`;
    await sql`DELETE FROM email_drafts WHERE id = ${id}::bigint`;
  }
});

integration("live sender schedules retry after mocked Resend 500", async () => {
  const sql = neon(databaseUrl!);
  const marker = `sender-live-retry-${crypto.randomUUID()}`;
  const id = await createScheduledDraft(sql, marker);
  const fetchMock = stubResendResponse(500, { message: "temporary" });
  try {
    await runScheduledEmailSender({
      DATABASE_URL: databaseUrl!, API_TOKEN: "sender-test-token",
      RESEND_API_KEY: "test-resend-key", RESEND_WEBHOOK_SECRET: "",
      EMAIL_SEND_MODE: "live",
    });
    const rows = await sql`SELECT status, scheduled_at, metadata FROM email_drafts WHERE id = ${id}::bigint`;
    expect(rows[0].status).toBe("scheduled");
    expect(new Date(rows[0].scheduled_at).getTime()).toBeGreaterThan(Date.now());
    expect(rows[0].metadata?.last_error_code).toBe("PROVIDER_SERVER_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    await sql`DELETE FROM email_events WHERE draft_id = ${id}::bigint`;
    await sql`DELETE FROM email_drafts WHERE id = ${id}::bigint`;
  }
});

integration("live sender marks mocked permanent Resend 422 as failed", async () => {
  const sql = neon(databaseUrl!);
  const marker = `sender-live-permanent-${crypto.randomUUID()}`;
  const id = await createScheduledDraft(sql, marker);
  const fetchMock = stubResendResponse(422, { message: "invalid payload" });
  try {
    await runScheduledEmailSender({
      DATABASE_URL: databaseUrl!, API_TOKEN: "sender-test-token",
      RESEND_API_KEY: "test-resend-key", RESEND_WEBHOOK_SECRET: "",
      EMAIL_SEND_MODE: "live",
    });
    const rows = await sql`SELECT status, metadata FROM email_drafts WHERE id = ${id}::bigint`;
    expect(rows[0].status).toBe("failed");
    expect(rows[0].metadata?.last_error_code).toBe("PROVIDER_HTTP_422");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    await sql`DELETE FROM email_events WHERE draft_id = ${id}::bigint`;
    await sql`DELETE FROM email_drafts WHERE id = ${id}::bigint`;
  }
});
