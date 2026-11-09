# AIL LABS Workspace — Email API

Base path: /api/email. All routes require Cloudflare Access JWT or Bearer API_TOKEN except POST /webhook/resend.
Success envelope: { "data": ..., "meta": { "requestId": "..." } }. Errors: { "error": { "code": "...", "message": "...", "details": {} }, "meta": { "requestId": "..." } }.

## Routes
- GET /threads?folder=inbox&label=&q=&filter=all&cursor=&limit=25
- GET /threads/:id
- PATCH /threads/:id — accepts only isRead and isStarred
- POST /threads/:id/archive — idempotent
- GET /drafts
- POST /drafts
- POST /drafts/:id/approve — requires needs_ok, valid recipient and idempotencyKey; schedules +10s
- POST /drafts/:id/cancel — only scheduled and not processing
- POST /webhook/resend — Svix signed inbound webhook

Thread fields: id (thread_<id>), subject, snippet, folder, isRead, isStarred, needsApproval, lastMessageAt, labels[].
List meta includes counts: inbox, unread, needsApproval, sent, drafts, archive. Filters: folder, label, q, filter=all|unread|needs-approval|attachments, keyset cursor (last_message_at,id), limit max 100.
Thread detail includes thread, messages, attachment metadata, labels and associated draft. HTML is never emitted as trusted markup; API returns body_text and body_html only with explicit unsafe marker.
Archive is idempotent. Webhook deduplicates on resend_email_id. Thread matching prioritizes In-Reply-To/References, then normalized subject + sender in 30 days.
Scheduled sends use cron each minute, maximum 10 drafts per run. EMAIL_SEND_MODE defaults to dry-run; dry-run records a dry-run event and never sends. Live sends use Resend Idempotency-Key = draft ID.
