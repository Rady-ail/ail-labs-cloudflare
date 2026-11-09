# AIL LABS Workspace — CRM API

Base path: /api/crm. All routes require Cloudflare Access JWT or Bearer API_TOKEN.
Collection envelope: { "data": [], "meta": { "page": 1, "limit": 25, "total": 0, "total_pages": 0 } }.
Mutation envelope: { "data": { "id": "..." }, "message": "..." }.
Error envelope: { "error": { "code": "...", "message": "...", "fields": {}, "request_id": "..." } }.

## Routes
- GET /clinics?page=1&limit=25&q=&stage=&province=&sort=updated_at&order=desc
- POST /clinics
- GET /clinics/:id — clinic, contacts, activities (occurred_at DESC, max 200), followups
- PATCH /clinics/:id — mutable clinic fields only; archived clinic returns 409 ARCHIVED_CLINIC
- POST /clinics/:id/archive
- POST /clinics/:id/move-stage
- POST /clinics/:id/activities
- GET /clinics/:id/contacts
- POST /clinics/:id/contacts
- PATCH /clinics/:id/contacts/:contactId
- DELETE /clinics/:id/contacts/:contactId
- POST /clinics/:id/follow-ups — updates existing pending follow-up rather than duplicating
- POST /clinics/:id/follow-ups/:followupId/complete

Stages: lead, contacted, catalog_sent, negotiating, ordered, active, inactive.
Activity types: note, call, whatsapp, email, catalog, order, stage_change.
Phone normalization: strip spaces, punctuation and leading +; convert 0-prefix to 62; convert 8-prefix to 62; preserve 62-prefix. Final regex: ^628[1-9][0-9]{7,11}$. Invalid values return 422 INVALID_PHONE.
IDs for clinic, clinic-contact and follow-up resources must be UUIDs.
CRM mutations use transactions and write audit_log; email payload/body content is never copied to audit logs.
GET /clinics meta.counts includes total and by_stage (all seven stages) and by_province for every non-archived clinic, independent of pagination.
