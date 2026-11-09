import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok, created, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
import { readJsonObject } from "../../lib/body";
import {
  actor, assertAllowedKeys, assertNoQuery, invalid, jsonString, parseBigintId, parseRecipients, validateDraftFields,
} from "./shared";

const draftsRoutes = new Hono<AppEnv>();

function draftView(row: Record<string, any>) {
  return {
    id: String(row.id), threadId: row.thread_id === null ? null : String(row.thread_id),
    subject: row.subject, to: row.to_recipients ?? [], cc: row.cc_recipients ?? [],
    bcc: row.bcc_recipients ?? [], bodyText: row.body_text, status: row.status,
    requestedBy: row.requested_by ?? null, approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

draftsRoutes.post("/drafts", async (c) => {
  assertNoQuery(c);
  const body = await readJsonObject(c);
  const input = validateDraftFields(body, false);
  const sql = getSql(c.env);
  const threadId = input.threadId ?? null;
  const rows = await sql`WITH target_thread AS MATERIALIZED (
      SELECT id FROM email_threads WHERE id = ${threadId}::bigint
    ), inserted AS (
      INSERT INTO email_drafts (thread_id, subject, to_recipients, cc_recipients, bcc_recipients, body_text, status)
      SELECT ${threadId}::bigint, ${input.subject}, ${jsonString(input.to)}::jsonb,
        ${jsonString(input.cc)}::jsonb, ${jsonString(input.bcc)}::jsonb, ${input.bodyText}, 'draft'
      WHERE ${threadId}::bigint IS NULL OR EXISTS (SELECT 1 FROM target_thread)
      RETURNING id, thread_id, subject, to_recipients, cc_recipients, bcc_recipients,
        body_text, status, requested_by, approved_by, approved_at, scheduled_at,
        sent_at, cancelled_at, created_at, updated_at
    ), event AS (
      INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
      SELECT thread_id, id, 'draft_created', ${actor(c)}, '{}'::jsonb FROM inserted
      RETURNING id
    )
    SELECT * FROM inserted`;
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) return fail(c, 404, "THREAD_NOT_FOUND", "Email thread tidak ditemukan");
  return created(c, draftView(row));
});

draftsRoutes.patch("/drafts/:draftId", async (c) => {
  assertNoQuery(c);
  const draftId = parseBigintId(c.req.param("draftId"), "draftId");
  const body = await readJsonObject(c);
  const input = validateDraftFields(body, true);
  if (!Object.keys(body).length) invalid("Minimal satu field draft harus diubah");
  const sql = getSql(c.env);
  const currentRows = await sql`SELECT id, status, to_recipients, cc_recipients, bcc_recipients
    FROM email_drafts WHERE id = ${draftId} LIMIT 1`;
  const current = currentRows[0] as Record<string, any> | undefined;
  if (!current) return fail(c, 404, "DRAFT_NOT_FOUND", "Draft tidak ditemukan");
  if (!["draft", "needs_ok"].includes(String(current.status))) {
    return fail(c, 409, "STATE_CONFLICT", "Draft tidak dapat diubah pada status ini", { status: current.status });
  }
  const total = (input.to ?? current.to_recipients ?? []).length
    + (input.cc ?? current.cc_recipients ?? []).length
    + (input.bcc ?? current.bcc_recipients ?? []).length;
  if (total > 50) invalid("Maksimal 50 penerima gabungan", { field: "recipients" });
  const rows = await sql`WITH updated AS (
      UPDATE email_drafts SET
        subject = CASE WHEN ${Object.hasOwn(input, "subject")} THEN ${input.subject ?? null} ELSE subject END,
        to_recipients = CASE WHEN ${Object.hasOwn(input, "to")} THEN ${jsonString(input.to)}::jsonb ELSE to_recipients END,
        cc_recipients = CASE WHEN ${Object.hasOwn(input, "cc")} THEN ${jsonString(input.cc)}::jsonb ELSE cc_recipients END,
        bcc_recipients = CASE WHEN ${Object.hasOwn(input, "bcc")} THEN ${jsonString(input.bcc)}::jsonb ELSE bcc_recipients END,
        body_text = CASE WHEN ${Object.hasOwn(input, "bodyText")} THEN ${input.bodyText ?? null} ELSE body_text END,
        updated_at = now()
      WHERE id = ${draftId} AND status IN ('draft', 'needs_ok')
      RETURNING id, thread_id, subject, to_recipients, cc_recipients, bcc_recipients,
        body_text, status, requested_by, approved_by, approved_at, scheduled_at,
        sent_at, cancelled_at, created_at, updated_at
    ), event AS (
      INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
      SELECT thread_id, id, 'draft_updated', ${actor(c)}, '{}'::jsonb FROM updated
      RETURNING id
    )
    SELECT * FROM updated`;
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) {
    const actual = await sql`SELECT status FROM email_drafts WHERE id = ${draftId} LIMIT 1`;
    if (!actual[0]) return fail(c, 404, "DRAFT_NOT_FOUND", "Draft tidak ditemukan");
    return fail(c, 409, "STATE_CONFLICT", "Draft berubah status dan tidak dapat diubah", { status: actual[0].status });
  }
  return ok(c, draftView(row));
});

draftsRoutes.post("/drafts/:draftId/request-approval", async (c) => {
  assertNoQuery(c);
  const draftId = parseBigintId(c.req.param("draftId"), "draftId");
  const body = await readJsonObject(c);
  assertAllowedKeys(body, ["comment"]);
  if (Object.hasOwn(body, "comment") && (typeof body.comment !== "string" || body.comment.length > 1000)) {
    invalid("comment harus berupa teks maksimal 1.000 karakter", { field: "comment" });
  }
  const comment = typeof body.comment === "string" ? body.comment.trim() : null;
  const sql = getSql(c.env);
  const rows = await sql`WITH updated AS (
      UPDATE email_drafts SET status = 'needs_ok', requested_by = ${actor(c)},
        metadata = metadata || jsonb_build_object('requested_at', now()::text, 'approval_comment', ${comment}::text),
        updated_at = now()
      WHERE id = ${draftId} AND status = 'draft'
      RETURNING id, thread_id, subject, to_recipients, cc_recipients, bcc_recipients,
        body_text, status, requested_by, approved_by, approved_at, scheduled_at,
        sent_at, cancelled_at, created_at, updated_at
    ), thread_update AS (
      UPDATE email_threads t SET needs_approval = true, updated_at = now()
      FROM updated u WHERE t.id = u.thread_id
      RETURNING t.id
    ), event AS (
      INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
      SELECT thread_id, id, 'approval_requested', ${actor(c)},
        jsonb_build_object('comment', ${comment}::text) FROM updated
      RETURNING id
    )
    SELECT * FROM updated`;
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) {
    const actual = await sql`SELECT status FROM email_drafts WHERE id = ${draftId} LIMIT 1`;
    if (!actual[0]) return fail(c, 404, "DRAFT_NOT_FOUND", "Draft tidak ditemukan");
    return fail(c, 409, "STATE_CONFLICT", "Permintaan persetujuan hanya berlaku untuk draft", { status: actual[0].status });
  }
  return ok(c, draftView(row));
});

draftsRoutes.post("/drafts/:draftId/approve", async (c) => {
  assertNoQuery(c);
  const draftId = parseBigintId(c.req.param("draftId"), "draftId");
  const body = await readJsonObject(c);
  assertAllowedKeys(body, ["approvalDecision", "idempotencyKey"]);
  if (body.approvalDecision !== "approve") invalid("approvalDecision harus bernilai approve");
  if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length < 1 || body.idempotencyKey.length > 200) {
    invalid("idempotencyKey wajib berupa teks 1–200 karakter");
  }
  const key = body.idempotencyKey.trim();
  const sql = getSql(c.env);

  const prior = await sql`SELECT id::text AS id, status, idempotency_key, metadata,
      subject, body_text, to_recipients, cc_recipients, bcc_recipients
    FROM email_drafts WHERE id = ${draftId} LIMIT 1`;
  const draft = prior[0] as Record<string, any> | undefined;
  if (!draft) return fail(c, 404, "DRAFT_NOT_FOUND", "Draft tidak ditemukan");
  if (draft.idempotency_key === key) {
    const jobId = draft.metadata?.job_id;
    if (typeof jobId === "string") return ok(c, { draftId: String(draft.id), status: "scheduled", jobId });
  }
  if (draft.status !== "needs_ok") {
    return fail(c, 409, "STATE_CONFLICT", "Draft belum meminta persetujuan", { status: draft.status });
  }
  const recipients = [
    ...parseRecipients(draft.to_recipients, "to"),
    ...parseRecipients(draft.cc_recipients, "cc"),
    ...parseRecipients(draft.bcc_recipients, "bcc"),
  ];
  if (recipients.length > 50) invalid("Maksimal 50 penerima gabungan; persetujuan ditolak");
  if (typeof draft.subject !== "string" || draft.subject.length > 300
    || typeof draft.body_text !== "string" || draft.body_text.length > 50000) {
    invalid("Isi draft tidak valid; persetujuan ditolak");
  }
  const jobId = crypto.randomUUID();
  let rows: any[];
  try {
    rows = await sql`WITH updated AS (
        UPDATE email_drafts SET status = 'scheduled', approved_by = ${actor(c)},
          approved_at = now(), scheduled_at = now() + interval '10 seconds',
          idempotency_key = ${key}, metadata = metadata || jsonb_build_object('job_id', ${jobId}::text),
          updated_at = now()
        WHERE id = ${draftId} AND status = 'needs_ok' AND idempotency_key IS NULL
        RETURNING id, thread_id, idempotency_key, metadata, scheduled_at
      ), event AS (
        INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
        SELECT thread_id, id, 'draft_approved', ${actor(c)}, jsonb_build_object('scheduled_at', scheduled_at)
        FROM updated RETURNING id
      ), job_event AS (
        INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
        SELECT thread_id, id, 'send_job_created', ${actor(c)},
          jsonb_build_object('job_id', metadata->>'job_id', 'scheduled_at', scheduled_at)
        FROM updated RETURNING id
      )
      SELECT id::text AS id, idempotency_key, metadata, scheduled_at FROM updated
      UNION ALL
      SELECT id::text AS id, idempotency_key, metadata, scheduled_at
      FROM email_drafts WHERE id = ${draftId} AND idempotency_key = ${key}
        AND NOT EXISTS (SELECT 1 FROM updated)`;
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      const existing = await sql`SELECT id::text AS id, status, metadata FROM email_drafts WHERE idempotency_key = ${key} LIMIT 1`;
      if (existing[0] && String(existing[0].id) === String(draftId) && existing[0].status === "scheduled") {
        const existingJobId = (existing[0] as Record<string, any>).metadata?.job_id;
        return ok(c, { draftId: String(draftId), status: "scheduled", jobId: existingJobId });
      }
      return fail(c, 409, "STATE_CONFLICT", "idempotencyKey sudah digunakan");
    }
    throw error;
  }
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) {
    const actual = await sql`SELECT status, idempotency_key, metadata FROM email_drafts WHERE id = ${draftId} LIMIT 1`;
    if (!actual[0]) return fail(c, 404, "DRAFT_NOT_FOUND", "Draft tidak ditemukan");
    if (actual[0].idempotency_key === key) {
      const existingJobId = (actual[0] as Record<string, any>).metadata?.job_id;
      if (typeof existingJobId === "string") {
        return ok(c, { draftId: String(draftId), status: "scheduled", jobId: existingJobId });
      }
    }
    return fail(c, 409, "STATE_CONFLICT", "Draft tidak dapat disetujui pada status ini", { status: actual[0].status });
  }
  if (String(row.id) !== String(draftId)) return fail(c, 409, "STATE_CONFLICT", "idempotencyKey sudah digunakan");
  const resolvedJobId = (row as Record<string, any>).metadata?.job_id;
  return ok(c, { draftId: String(row.id), status: "scheduled", jobId: String(resolvedJobId ?? jobId) });
});

draftsRoutes.post("/drafts/:draftId/cancel", async (c) => {
  assertNoQuery(c);
  const draftId = parseBigintId(c.req.param("draftId"), "draftId");
  const body = await readJsonObject(c);
  assertAllowedKeys(body, ["reason"]);
  if (typeof body.reason !== "string" || body.reason.trim().length === 0 || body.reason.length > 1000) {
    invalid("reason wajib berupa teks 1–1.000 karakter", { field: "reason" });
  }
  const reason = body.reason.trim();
  const sql = getSql(c.env);
  const rows = await sql`WITH updated AS (
      UPDATE email_drafts SET status = 'cancelled', cancelled_at = now(),
        metadata = metadata || jsonb_build_object('cancel_reason', ${reason}::text),
        updated_at = now()
      WHERE id = ${draftId} AND status = 'scheduled'
        AND COALESCE(metadata->>'processing_at', '') = ''
      RETURNING id::text AS id, thread_id, status, cancelled_at, metadata
    ), event AS (
      INSERT INTO email_events (thread_id, draft_id, event_type, actor, event_data)
      SELECT thread_id, id::bigint, 'send_job_cancelled', ${actor(c)},
        jsonb_build_object('reason', ${reason}::text) FROM updated
      RETURNING id
    )
    SELECT * FROM updated`;
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) {
    const actual = await sql`SELECT status, metadata->>'processing_at' AS processing_at
      FROM email_drafts WHERE id = ${draftId} LIMIT 1`;
    if (!actual[0]) return fail(c, 404, "DRAFT_NOT_FOUND", "Draft tidak ditemukan");
    return fail(c, 409, "STATE_CONFLICT", "Job tidak dapat dibatalkan", {
      status: actual[0].status, processingAt: actual[0].processing_at ?? null,
    });
  }
  return ok(c, { draftId: String(row.id), status: "cancelled", cancelledAt: new Date(row.cancelled_at).toISOString() });
});

export { draftsRoutes };
