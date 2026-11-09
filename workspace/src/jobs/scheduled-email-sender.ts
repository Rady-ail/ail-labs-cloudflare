import type { Env } from "../env";
import { getSql } from "../lib/db";
import { isEmail } from "../lib/validate";

const FROM = "Alexa <alexa@ail-aesthetic-labs.my.id>";
const MAX_PER_RUN = 10;
const MAX_ATTEMPTS = 3;

type ClaimedDraft = {
  id: string;
  thread_id: string | null;
  subject: string;
  to_recipients: unknown;
  cc_recipients: unknown;
  bcc_recipients: unknown;
  body_text: string;
  metadata: Record<string, unknown>;
  attempt: number;
};

function recipientList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean);
}

function validDraft(draft: ClaimedDraft): { to: string[]; cc: string[]; bcc: string[] } | null {
  const to = recipientList(draft.to_recipients);
  const cc = recipientList(draft.cc_recipients);
  const bcc = recipientList(draft.bcc_recipients);
  const all = [...to, ...cc, ...bcc];
  if (!to.length || all.length > 50 || all.some((item) => !isEmail(item))) return null;
  if (typeof draft.subject !== "string" || !draft.subject.trim() || draft.subject.length > 300) return null;
  if (typeof draft.body_text !== "string" || draft.body_text.length > 50_000) return null;
  return { to, cc, bcc };
}

async function updateFailure(
  sql: ReturnType<typeof getSql>,
  draft: ClaimedDraft,
  reason: string,
  retryable: boolean,
): Promise<void> {
  if (retryable && draft.attempt < MAX_ATTEMPTS) {
    const delaySeconds = 60 * (2 ** Math.max(0, draft.attempt - 1));
    await sql`WITH updated AS (
        UPDATE email_drafts SET
          scheduled_at = now() + make_interval(secs => ${delaySeconds}::int),
          metadata = (metadata - 'processing_at') || jsonb_build_object(
            'last_error_code', ${reason}::text, 'last_retry_at', now()::text
          ),
          updated_at = now()
        WHERE id = ${draft.id}::bigint AND status = 'scheduled'
        RETURNING id, thread_id
      )
      INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
      SELECT thread_id, id, 'send_job_retry', 'scheduled_sender',
        jsonb_build_object('attempt', ${draft.attempt}::int, 'retry_in_seconds', ${delaySeconds}::int,
          'error_code', ${reason}::text) FROM updated`;
    return;
  }

  await sql`WITH updated AS (
      UPDATE email_drafts SET status = 'failed',
        metadata = (metadata - 'processing_at') || jsonb_build_object(
          'last_error_code', ${reason}::text, 'failed_at', now()::text
        ),
        updated_at = now()
      WHERE id = ${draft.id}::bigint AND status = 'scheduled'
      RETURNING id, thread_id
    )
    INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
    SELECT thread_id, id, 'send_job_failed', 'scheduled_sender',
      jsonb_build_object('attempt', ${draft.attempt}::int, 'error_code', ${reason}::text) FROM updated`;
}

async function markDryRun(sql: ReturnType<typeof getSql>, draft: ClaimedDraft): Promise<void> {
  await sql`WITH updated AS (
      UPDATE email_drafts SET status = 'sent', sent_at = now(),
        metadata = (metadata - 'processing_at') || jsonb_build_object(
          'dry_run', true, 'dry_run_at', now()::text
        ),
        updated_at = now()
      WHERE id = ${draft.id}::bigint AND status = 'scheduled'
      RETURNING id, thread_id
    )
    INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
    SELECT thread_id, id, 'send_job_dry_run', 'scheduled_sender',
      jsonb_build_object('dry_run', true) FROM updated`;
}

async function sendLive(
  sql: ReturnType<typeof getSql>,
  env: Env,
  draft: ClaimedDraft,
  recipients: { to: string[]; cc: string[]; bcc: string[] },
): Promise<void> {
  const jobId = typeof draft.metadata.job_id === "string" ? draft.metadata.job_id : "";
  if (!jobId) {
    await updateFailure(sql, draft, "MISSING_JOB_ID", false);
    return;
  }
  if (!env.RESEND_API_KEY) {
    await updateFailure(sql, draft, "RESEND_NOT_CONFIGURED", false);
    return;
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": jobId,
      },
      body: JSON.stringify({
        from: FROM,
        to: recipients.to,
        cc: recipients.cc.length ? recipients.cc : undefined,
        bcc: recipients.bcc.length ? recipients.bcc : undefined,
        subject: draft.subject,
        text: draft.body_text,
      }),
    });
  } catch {
    await updateFailure(sql, draft, "PROVIDER_NETWORK_ERROR", true);
    return;
  }

  let result: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
  } catch {
    // A non-JSON provider response is handled by its HTTP status.
  }

  if (!response.ok) {
    const code = response.status === 429 ? "PROVIDER_RATE_LIMIT"
      : response.status >= 500 ? "PROVIDER_SERVER_ERROR"
      : `PROVIDER_HTTP_${response.status}`;
    await updateFailure(sql, draft, code, response.status === 429 || response.status >= 500);
    return;
  }

  const resendId = typeof result.id === "string" ? result.id : "";
  if (!resendId) {
    await updateFailure(sql, draft, "PROVIDER_RESPONSE_INVALID", true);
    return;
  }

  let threadId = draft.thread_id;
  if (!threadId) {
    const thread = await sql`INSERT INTO email_threads
        (subject, folder, snippet, last_message_at, created_at, updated_at)
      VALUES (${draft.subject}, 'sent', ${draft.body_text.slice(0, 240)}, now(), now(), now())
      RETURNING id::text AS id`;
    threadId = String(thread[0].id);
  }

  const messageRows = await sql`INSERT INTO email_messages
      (thread_id, resend_email_id, direction, from_email, to_recipients, cc_recipients,
       bcc_recipients, subject, body_text, sent_at, metadata)
    VALUES (${threadId}::bigint, ${resendId}, 'outbound', 'alexa@ail-aesthetic-labs.my.id',
      ${JSON.stringify(recipients.to)}::jsonb, ${JSON.stringify(recipients.cc)}::jsonb,
      ${JSON.stringify(recipients.bcc)}::jsonb, ${draft.subject}, ${draft.body_text},
      now(), ${JSON.stringify({ provider: "resend", job_id: jobId })}::jsonb)
    ON CONFLICT (resend_email_id) DO UPDATE SET resend_email_id = EXCLUDED.resend_email_id
    RETURNING id::text AS id`;

  await sql`WITH updated AS (
      UPDATE email_drafts SET status = 'sent', sent_at = now(),
        sent_message_id = ${messageRows[0].id}::bigint,
        metadata = (metadata - 'processing_at') || jsonb_build_object(
          'resend_email_id', ${resendId}::text, 'sent_at', now()::text
        ),
        updated_at = now()
      WHERE id = ${draft.id}::bigint AND status = 'scheduled'
      RETURNING id, thread_id
    ), event AS (
      INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
      SELECT COALESCE(thread_id, ${threadId}::bigint), id, 'message_sent', 'scheduled_sender',
        jsonb_build_object('resend_email_id', ${resendId}::text, 'job_id', ${jobId}::text) FROM updated
      RETURNING id
    )
    UPDATE email_threads SET folder = 'sent', last_message_at = now(), updated_at = now()
    WHERE id = ${threadId}::bigint`;
}

export async function runScheduledEmailSender(env: Env): Promise<void> {
  const sql = getSql(env);
  const claimed = await sql`WITH candidates AS (
      SELECT id FROM email_drafts
      WHERE status = 'scheduled'
        AND scheduled_at IS NOT NULL AND scheduled_at <= now()
        AND (
          NULLIF(metadata->>'processing_at', '') IS NULL
          OR (metadata->>'processing_at')::timestamptz < now() - interval '10 minutes'
        )
      ORDER BY scheduled_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${MAX_PER_RUN}
    ), updated AS (
      UPDATE email_drafts d SET
        metadata = d.metadata || jsonb_build_object(
          'processing_at', now()::text,
          'attempts', CASE WHEN d.metadata->>'attempts' ~ '^[0-9]+$'
            THEN (d.metadata->>'attempts')::int + 1 ELSE 1 END
        ),
        updated_at = now()
      FROM candidates c WHERE d.id = c.id
      RETURNING d.id::text AS id, d.thread_id::text AS thread_id, d.subject,
        d.to_recipients, d.cc_recipients, d.bcc_recipients, d.body_text, d.metadata,
        CASE WHEN d.metadata->>'attempts' ~ '^[0-9]+$'
          THEN (d.metadata->>'attempts')::int ELSE 1 END AS attempt
    )
    SELECT * FROM updated`;

  for (const raw of claimed as ClaimedDraft[]) {
    const draft = raw;
    const recipients = validDraft(draft);
    if (!recipients) {
      await updateFailure(sql, draft, "DRAFT_VALIDATION_FAILED", false);
      continue;
    }

    const allRecipients = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    const suppressed = await sql`SELECT email FROM email_suppressions
      WHERE lower(email) = ANY(${allRecipients.map((email) => email.toLowerCase())}::text[])
      LIMIT 1`;
    if (suppressed.length) {
      await updateFailure(sql, draft, "RECIPIENT_SUPPRESSED", false);
      continue;
    }

    if (env.EMAIL_SEND_MODE !== "live") {
      await markDryRun(sql, draft);
      continue;
    }

    await sendLive(sql, env, draft, recipients);
  }
}
