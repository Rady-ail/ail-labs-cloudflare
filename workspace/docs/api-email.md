# Email API

Base path: `/api/email`. JSON success responses use `{ "data": ..., "meta": { "requestId": "..." } }`. Errors use `{ "error": { "code": "...", "message": "...", "details"?: ... }, "meta": { "requestId": "..." } }`.

Protected routes accept `Authorization: Bearer <API_TOKEN>` or a valid Cloudflare Access JWT in `Cf-Access-Jwt-Assertion`. Mutating requests are origin-checked. Non-CRM API request bodies are limited to 256 KiB; the Resend webhook has its own 1 MiB raw-body limit.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/email/threads` | List threads. Query allowlist: `folder`, `label`, `q`, `filter`, `cursor`, `limit`. |
| GET | `/api/email/threads/:threadId` | Thread, messages, drafts and safe attachment metadata. |
| PATCH | `/api/email/threads/:threadId` | Update read/star flags. |
| POST | `/api/email/threads/:threadId/archive` | Archive a thread. |
| POST | `/api/email/drafts` | Create a draft. Body: `threadId?`, `subject`, `to`, `cc`, `bcc`, `bodyText`. |
| PATCH | `/api/email/drafts/:draftId` | Edit a draft in editable status. |
| POST | `/api/email/drafts/:draftId/request-approval` | Request approval. Body: optional `comment`. |
| POST | `/api/email/drafts/:draftId/approve` | Approve and schedule. Body: `{ "approvalDecision": "approve", "idempotencyKey": "..." }`. |
| POST | `/api/email/drafts/:draftId/cancel` | Cancel a scheduled job. |
| GET | `/api/email/live/status` | Database/sending status without returning credentials. |
| GET | `/api/email/live/new-count?since=<ISO-8601>` | Count and IDs of inbound messages since timestamp. |

Example create draft:

```http
POST /api/email/drafts
Authorization: Bearer <API_TOKEN>
Content-Type: application/json

{
  "subject": "Product information",
  "to": ["clinic@example.test"],
  "cc": [],
  "bcc": [],
  "bodyText": "Draft for review."
}
```

Example approval:

```json
{ "approvalDecision": "approve", "idempotencyKey": "unique-operation-key" }
```

## Webhook: Resend

`POST /api/webhooks/resend` is mounted outside `/api/email` and is exempt from bearer auth, origin checking, and API rate limiting. It requires a valid Svix signature using `RESEND_WEBHOOK_SECRET`, a fresh timestamp (300-second tolerance), and a raw body no larger than 1 MiB. Invalid signatures return 401; missing configuration returns 503; oversized body returns 413. Repeated provider message IDs/events are handled idempotently. Received messages are threaded using message-id/in-reply-to/references, with a bounded subject/sender fallback. Bounce and complaint events add recipients to suppression.

## Common error codes

- `UNAUTHORIZED` (401), `FORBIDDEN` (403), `RATE_LIMITED` (429)
- `BAD_REQUEST` (400), `INVALID_EMAIL_INPUT` (422), `PAYLOAD_TOO_LARGE` (413)
- `THREAD_NOT_FOUND` / `DRAFT_NOT_FOUND` (404)
- `STATE_CONFLICT` (409), `DATABASE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500)

## Scheduled sender

The Worker Cron invokes the sender once per minute; at most 10 due drafts are claimed per run using row locking/atomic claim. A claim older than 10 minutes can be recovered. Suppressed recipients and invalid drafts are marked failed without sending.

- `EMAIL_SEND_MODE=dry-run` (default): no Resend request is made; the draft status is changed to `sent` with `dry_run=true` and a dry-run event. This status means the scheduled job was consumed in dry-run mode, not that an email was transmitted.
- `EMAIL_SEND_MODE=live`: sends through Resend using the stable job ID as the provider idempotency key. Successful provider responses create the outbound message and mark the draft sent.
- Network failures, HTTP 429 and HTTP 5xx are retried up to three attempts with exponential delays (60 seconds, then 120 seconds). Other HTTP errors and permanent validation/configuration failures are not retried. Exhausted retries become `failed`.
- Bounce/complaint suppression is checked before a send. The webhook maintains the suppression list.

Live sending is a consequential operation. Keep the configured default at dry-run; changing it to live requires Rady's explicit approval and Claude's controlled operation.
