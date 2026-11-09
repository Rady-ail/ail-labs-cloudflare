# CRM API

Base path: `/api/crm`. Authentication accepts `Authorization: Bearer <API_TOKEN>` or a valid Cloudflare Access JWT. CRM routes retain their own response envelope.

Success responses return a JSON object containing `data` and route-specific pagination/summary metadata. Errors use:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Parameter tidak valid.",
    "fields": {},
    "request_id": "..."
  }
}
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/crm/clinics` | List/search/filter clinics. Query: `search`, `stage`, `province`, `tag`, `sort`, `order`, `page`, `limit`, `interest`, `archived`. |
| POST | `/api/crm/clinics` | Create clinic. |
| GET | `/api/crm/clinics/:id` | Clinic detail with tags, contacts, activities and follow-ups. |
| PATCH | `/api/crm/clinics/:id` | Update clinic fields. |
| POST | `/api/crm/clinics/:id/stage` | Change clinic stage. Body contains `stage`. |
| POST | `/api/crm/clinics/:id/archive` | Archive clinic. |
| GET | `/api/crm/clinics/:id/contacts` | List clinic contacts. |
| POST | `/api/crm/clinics/:id/contacts` | Add clinic contact. |
| PATCH | `/api/crm/contacts/:contactId` | Update a contact. |
| DELETE | `/api/crm/contacts/:contactId` | Delete a contact. |
| POST | `/api/crm/clinics/:id/activities` | Record a clinic activity. |
| GET | `/api/crm/clinics/:id/activities` | List clinic activities. |
| POST | `/api/crm/clinics/:id/followups` | Create a follow-up. |
| PATCH | `/api/crm/followups/:id` | Update a follow-up. |
| POST | `/api/crm/followups/:id/complete` | Complete a follow-up. |
| GET | `/api/crm/follow-ups` | List/filter follow-ups. |
| GET | `/api/crm/regions/summary` | Regional clinic summary. |

## Example

```http
GET /api/crm/clinics?page=1&limit=20&stage=lead&archived=false
Authorization: Bearer <API_TOKEN>
```

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "total_pages": 0
  }
}
```

Create/update bodies are validated against route-specific allowlists and clinic/contact/activity/follow-up model rules. Unknown query/body fields return `BAD_REQUEST` or `VALIDATION_ERROR`; invalid values return `INVALID_STAGE`, `INVALID_*`, or `VALIDATION_ERROR` (422); missing resources return `CLINIC_NOT_FOUND`, `CONTACT_NOT_FOUND`, or `FOLLOWUP_NOT_FOUND` (404); archived-resource conflicts return `ARCHIVED_CLINIC` (409). Other common statuses are 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 413 `PAYLOAD_TOO_LARGE`, and 500 `INTERNAL_ERROR`.

CRM errors use `fields` and `request_id` (snake case), unlike the email API envelope. CRM routes are excluded from the generic non-CRM body middleware, but every CRM mutation that reads JSON uses `readJsonObject`, which counts actual streamed bytes (not only `Content-Length`) and rejects bodies larger than 256 KiB with `PAYLOAD_TOO_LARGE` (413).
