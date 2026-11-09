import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
import { readJsonObject } from "../../lib/body";
import {
  actor, assertAllowedKeys, assertQueryKeys, assertNoQuery, badRequest, invalid, decodeCursor, encodeCursor,
  escapeLike, iso, parseBigintId, readOptionalJsonObject,
} from "./shared";

const threadsRoutes = new Hono<AppEnv>();

function listLimit(value: string | undefined): number {
  if (value === undefined || value === "") return 25;
  if (!/^[0-9]{1,3}$/.test(value)) badRequest("limit tidak valid");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 100) badRequest("limit harus 1–100");
  return parsed;
}

threadsRoutes.get("/threads", async (c) => {
  const query = c.req.query();
  assertQueryKeys(query, ["folder", "label", "q", "filter", "cursor", "limit"]);
  const folder = query.folder ?? "inbox";
  const filter = query.filter ?? "all";
  if (!["inbox", "sent", "drafts", "archive"].includes(folder)) badRequest("folder tidak valid");
  if (!["all", "unread", "needs-approval", "attachments"].includes(filter)) badRequest("filter tidak valid");
  const label = query.label?.trim() || null;
  const search = query.q?.trim() || null;
  if (search && search.length > 300) badRequest("q maksimal 300 karakter");
  const pattern = search ? `%${escapeLike(search)}%` : null;
  const cursor = decodeCursor(query.cursor);
  const limit = listLimit(query.limit);
  const sql = getSql(c.env);

  const [rows, totals] = await Promise.all([
    sql`SELECT t.id::text AS id, t.subject, COALESCE(t.snippet, '') AS snippet,
        CASE WHEN ${folder} = 'drafts' THEN 'drafts' WHEN ${folder} = 'archive' THEN 'archive' ELSE t.folder END AS folder,
        t.is_read AS "isRead", t.is_starred AS "isStarred", t.needs_approval AS "needsApproval",
        t.last_message_at AS "lastMessageAt", COALESCE(t.last_message_at, t.created_at) AS "cursorAt",
        COALESCE((SELECT json_agg(json_build_object('id', l.id::text, 'name', l.name, 'color', l.color)
          ORDER BY l.name) FROM email_thread_labels tl JOIN email_labels l ON l.id = tl.label_id
          WHERE tl.thread_id = t.id), '[]'::json) AS labels
      FROM email_threads t
      WHERE (
          (${folder} = 'archive' AND (t.is_archived = true OR t.folder = 'archive'))
          OR (${folder} = 'drafts' AND t.is_archived = false AND (
            t.folder = 'drafts' OR EXISTS (SELECT 1 FROM email_drafts d
              WHERE d.thread_id = t.id AND d.status IN ('draft', 'needs_ok'))
          ))
          OR (${folder} NOT IN ('archive', 'drafts') AND t.folder = ${folder} AND t.is_archived = false)
        )
        AND (${filter} = 'all'
          OR (${filter} = 'unread' AND t.is_read = false)
          OR (${filter} = 'needs-approval' AND t.needs_approval = true)
          OR (${filter} = 'attachments' AND EXISTS (
            SELECT 1 FROM email_messages m JOIN email_attachments a ON a.message_id = m.id
            WHERE m.thread_id = t.id
          )))
        AND (${label}::text IS NULL OR EXISTS (
          SELECT 1 FROM email_thread_labels tl JOIN email_labels l ON l.id = tl.label_id
          WHERE tl.thread_id = t.id AND l.name = ${label}
        ))
        AND (${pattern}::text IS NULL OR
          t.subject ILIKE ${pattern} ESCAPE '!'
          OR EXISTS (SELECT 1 FROM email_messages m
            WHERE m.thread_id = t.id AND (
              m.from_email ILIKE ${pattern} ESCAPE '!'
              OR COALESCE(m.body_text, '') ILIKE ${pattern} ESCAPE '!'
            ))
          OR EXISTS (SELECT 1 FROM contacts co
            WHERE co.id = t.contact_id AND (
              co.display_name ILIKE ${pattern} ESCAPE '!' OR co.email ILIKE ${pattern} ESCAPE '!'
            )))
        AND (${cursor?.at ?? null}::timestamptz IS NULL OR
          (COALESCE(t.last_message_at, t.created_at), t.id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::bigint))
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC
      LIMIT ${limit + 1}`,
    sql`SELECT count(*)::int AS total
      FROM email_threads t
      WHERE (
          (${folder} = 'archive' AND (t.is_archived = true OR t.folder = 'archive'))
          OR (${folder} = 'drafts' AND t.is_archived = false AND (
            t.folder = 'drafts' OR EXISTS (SELECT 1 FROM email_drafts d
              WHERE d.thread_id = t.id AND d.status IN ('draft', 'needs_ok'))
          ))
          OR (${folder} NOT IN ('archive', 'drafts') AND t.folder = ${folder} AND t.is_archived = false)
        )
        AND (${filter} = 'all'
          OR (${filter} = 'unread' AND t.is_read = false)
          OR (${filter} = 'needs-approval' AND t.needs_approval = true)
          OR (${filter} = 'attachments' AND EXISTS (
            SELECT 1 FROM email_messages m JOIN email_attachments a ON a.message_id = m.id
            WHERE m.thread_id = t.id
          )))
        AND (${label}::text IS NULL OR EXISTS (
          SELECT 1 FROM email_thread_labels tl JOIN email_labels l ON l.id = tl.label_id
          WHERE tl.thread_id = t.id AND l.name = ${label}
        ))
        AND (${pattern}::text IS NULL OR
          t.subject ILIKE ${pattern} ESCAPE '!'
          OR EXISTS (SELECT 1 FROM email_messages m
            WHERE m.thread_id = t.id AND (
              m.from_email ILIKE ${pattern} ESCAPE '!'
              OR COALESCE(m.body_text, '') ILIKE ${pattern} ESCAPE '!'
            ))
          OR EXISTS (SELECT 1 FROM contacts co
            WHERE co.id = t.contact_id AND (
              co.display_name ILIKE ${pattern} ESCAPE '!' OR co.email ILIKE ${pattern} ESCAPE '!'
            )))`,
  ]);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1] as Record<string, unknown> | undefined;
  const nextCursor = hasMore && last
    ? encodeCursor(new Date(String(last.cursorAt)).toISOString(), String(last.id))
    : null;
  return ok(c, {
    items: pageRows.map((row: Record<string, any>) => ({
      id: String(row.id), subject: row.subject, snippet: row.snippet, folder: row.folder,
      isRead: Boolean(row.isRead), isStarred: Boolean(row.isStarred), needsApproval: Boolean(row.needsApproval),
      lastMessageAt: iso(row.lastMessageAt), labels: row.labels ?? [],
    })),
    nextCursor, total: Number(totals[0]?.total ?? 0),
  });
});

threadsRoutes.get("/threads/:threadId", async (c) => {
  assertNoQuery(c);
  assertNoQuery(c);
  const threadId = parseBigintId(c.req.param("threadId"), "threadId");
  const sql = getSql(c.env);
  const rows = await sql`SELECT id::text AS id, external_thread_id, subject, folder, contact_id::text AS contact_id,
      snippet, is_read, is_starred, is_archived, needs_approval, last_message_at, created_at, updated_at
    FROM email_threads WHERE id = ${threadId} LIMIT 1`;
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) return fail(c, 404, "THREAD_NOT_FOUND", "Email thread tidak ditemukan");
  const [labelRows, messages, drafts] = await Promise.all([
    sql`SELECT l.id::text AS id, l.name, l.color FROM email_thread_labels tl
      JOIN email_labels l ON l.id = tl.label_id WHERE tl.thread_id = ${threadId} ORDER BY l.name`,
    sql`SELECT id::text AS id, thread_id::text AS thread_id, direction, from_email,
        to_recipients, cc_recipients, bcc_recipients, subject, body_text,
        received_at, sent_at, created_at
      FROM email_messages WHERE thread_id = ${threadId}
      ORDER BY COALESCE(received_at, sent_at, created_at) ASC, id ASC`,
    sql`SELECT id::text AS id, thread_id::text AS thread_id, subject, to_recipients, cc_recipients,
        bcc_recipients, body_text, status, requested_by, approved_by, approved_at,
        scheduled_at, sent_at, cancelled_at, created_at, updated_at
      FROM email_drafts WHERE thread_id = ${threadId} ORDER BY updated_at DESC`,
  ]);
  const messageIds = messages.map((message: Record<string, unknown>) => String(message.id));
  const attachments = messageIds.length
    ? await sql`SELECT id::text AS id, message_id::text AS message_id, filename,
        content_type, byte_size::text AS byte_size, checksum_sha256, created_at
      FROM email_attachments WHERE message_id = ANY(${messageIds}::bigint[])
      ORDER BY id ASC`
    : [];
  const attachmentsByMessage = new Map<string, any[]>();
  for (const attachment of attachments as Record<string, any>[]) {
    const key = String(attachment.message_id);
    const values = attachmentsByMessage.get(key) ?? [];
    values.push({
      id: String(attachment.id), filename: attachment.filename, contentType: attachment.content_type ?? null,
      byteSize: attachment.byte_size === null ? null : String(attachment.byte_size),
      checksumSha256: attachment.checksum_sha256 ?? null, createdAt: iso(attachment.created_at),
    });
    attachmentsByMessage.set(key, values);
  }
  return ok(c, {
    thread: {
      id: String(row.id), externalThreadId: row.external_thread_id ?? null, subject: row.subject,
      folder: row.folder, contactId: row.contact_id === null ? null : String(row.contact_id),
      snippet: row.snippet ?? "", isRead: Boolean(row.is_read), isStarred: Boolean(row.is_starred),
      isArchived: Boolean(row.is_archived), needsApproval: Boolean(row.needs_approval),
      lastMessageAt: iso(row.last_message_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      labels: labelRows.map((label: Record<string, any>) => ({
        id: String(label.id), name: label.name, color: label.color ?? null,
      })),
    },
    messages: (messages as Record<string, any>[]).map((message) => ({
      id: String(message.id), threadId: String(message.thread_id), direction: message.direction,
      from: message.from_email, to: message.to_recipients ?? [], cc: message.cc_recipients ?? [],
      bcc: message.bcc_recipients ?? [], subject: message.subject, bodyText: message.body_text ?? "",
      receivedAt: iso(message.received_at), sentAt: iso(message.sent_at), createdAt: iso(message.created_at),
      attachments: attachmentsByMessage.get(String(message.id)) ?? [],
    })),
    drafts: (drafts as Record<string, any>[]).map((draft) => ({
      id: String(draft.id), threadId: draft.thread_id === null ? null : String(draft.thread_id),
      subject: draft.subject, to: draft.to_recipients ?? [], cc: draft.cc_recipients ?? [],
      bcc: draft.bcc_recipients ?? [], bodyText: draft.body_text, status: draft.status,
      requestedBy: draft.requested_by ?? null, approvedBy: draft.approved_by ?? null,
      approvedAt: iso(draft.approved_at), scheduledAt: iso(draft.scheduled_at),
      sentAt: iso(draft.sent_at), cancelledAt: iso(draft.cancelled_at),
      createdAt: iso(draft.created_at), updatedAt: iso(draft.updated_at),
    })),
  });
});

threadsRoutes.patch("/threads/:threadId", async (c) => {
  assertNoQuery(c);
  assertNoQuery(c);
  const threadId = parseBigintId(c.req.param("threadId"), "threadId");
  const body = await readJsonObject(c);
  assertAllowedKeys(body, ["isRead", "isStarred"]);
  if (!Object.keys(body).length) badRequest("Minimal satu field harus diubah");
  for (const key of ["isRead", "isStarred"]) {
    if (Object.hasOwn(body, key) && typeof body[key] !== "boolean") invalid(`${key} harus boolean`, { field: key });
  }
  const hasRead = Object.hasOwn(body, "isRead");
  const hasStarred = Object.hasOwn(body, "isStarred");
  const sql = getSql(c.env);
  const rows = await sql`WITH before AS MATERIALIZED (
      SELECT id, is_read, is_starred FROM email_threads WHERE id = ${threadId} FOR UPDATE
    ), updated AS (
      UPDATE email_threads t SET
        is_read = CASE WHEN ${hasRead} THEN ${hasRead ? body.isRead : null}::boolean ELSE t.is_read END,
        is_starred = CASE WHEN ${hasStarred} THEN ${hasStarred ? body.isStarred : null}::boolean ELSE t.is_starred END,
        updated_at = now()
      FROM before b WHERE t.id = b.id
      RETURNING t.id::text AS id, t.is_read AS "isRead", t.is_starred AS "isStarred"
    ), events AS (
      INSERT INTO email_events (thread_id, event_type, actor, event_data)
      SELECT b.id, 'thread_marked_read', ${actor(c)}, jsonb_build_object('isRead', u.is_read)
      FROM before b JOIN updated u ON u.id::bigint = b.id
      WHERE ${hasRead} AND b.is_read IS DISTINCT FROM u.isRead
      UNION ALL
      SELECT b.id, 'thread_marked_starred', ${actor(c)}, jsonb_build_object('isStarred', u.isStarred)
      FROM before b JOIN updated u ON u.id::bigint = b.id
      WHERE ${hasStarred} AND b.is_starred IS DISTINCT FROM u.isStarred
      RETURNING id
    )
    SELECT id, "isRead", "isStarred" FROM updated`;
  const updated = rows[0] as Record<string, unknown> | undefined;
  if (!updated) return fail(c, 404, "THREAD_NOT_FOUND", "Email thread tidak ditemukan");
  return ok(c, { id: String(updated.id), isRead: Boolean(updated.isRead), isStarred: Boolean(updated.isStarred) });
});

threadsRoutes.post("/threads/:threadId/archive", async (c) => {
  assertNoQuery(c);
  assertNoQuery(c);
  const threadId = parseBigintId(c.req.param("threadId"), "threadId");
  const body = await readOptionalJsonObject(c);
  assertAllowedKeys(body, []);
  const sql = getSql(c.env);
  const rows = await sql`WITH before AS MATERIALIZED (
      SELECT id, is_archived FROM email_threads WHERE id = ${threadId} FOR UPDATE
    ), updated AS (
      UPDATE email_threads t SET is_archived = true, folder = 'archive', updated_at = now()
      FROM before b WHERE t.id = b.id
      RETURNING t.id::text AS id
    ), events AS (
      INSERT INTO email_events (thread_id, event_type, actor, event_data)
      SELECT b.id, 'thread_archived', ${actor(c)}, '{}'::jsonb
      FROM before b JOIN updated u ON u.id::bigint = b.id
      WHERE b.is_archived = false
      RETURNING id
    )
    SELECT id FROM updated`;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return fail(c, 404, "THREAD_NOT_FOUND", "Email thread tidak ditemukan");
  return ok(c, { id: String(row.id), isArchived: true });
});

export { threadsRoutes };
