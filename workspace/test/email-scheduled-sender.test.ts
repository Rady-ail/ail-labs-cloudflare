import { test, expect } from "vitest";
import { neon } from "@neondatabase/serverless";
import { runScheduledEmailSender } from "../src/jobs/scheduled-email-sender";

const runtime = (globalThis as any).process?.env ?? {};
const databaseUrl = runtime.DATABASE_URL as string | undefined;
const integration = databaseUrl ? test : test.skip;

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
