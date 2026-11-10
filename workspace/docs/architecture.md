# Architecture

## Runtime boundary

The `workspace/` directory is a standalone Worker project. It must not import from or modify the legacy catalog application outside this directory.

## Layers

1. HTTP edge: Hono routes, request IDs, strict origin policy, security headers, bounded request bodies.
2. Identity: Cloudflare Access JWT verification against the configured team JWKS, or constant-time comparison of a Bearer token with `API_TOKEN`.
3. Domain services: CRM, email, audit, scheduled sender, and optional AI assistance.
4. Persistence: Neon PostgreSQL over HTTP with parameterized tagged-template SQL. No ORM.
5. Presentation: static SPA served from `public/`; API paths are handled by the Worker.

## Authority and safety

- Rady is the final approver for payments, contracts, procurement decisions, and any transition to live external email.
- AI features are advisory: classify, summarize, draft, and retrieve. They do not approve, pay, contract, or send.
- Email sends require an approved draft and a due scheduled time. The production default remains `EMAIL_SEND_MODE=dry-run`.
- Email bodies and webhook payloads are untrusted data. Store body text; never execute or render raw HTML.
- Do not store email bodies, secrets, or full webhook payloads in audit records.

## Modules

- Core: auth, health, request IDs, validation, database, audit.
- CRM: clinics, contacts, stages, activities, follow-ups, regional aggregates.
- Email: threads, messages, drafts, approvals, suppression checks, Svix webhook, scheduled sender.
- AI: isolated service wrapper using `OPENAI_API_KEY`, with no authority to mutate approval state.
