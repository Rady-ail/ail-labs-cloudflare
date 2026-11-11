# AIL LABS Workspace

Private B2B operations workspace for AIL LABS. This application is isolated under `workspace/` and deploys as the separate Cloudflare Worker `ail-labs-workspace`.

## Architecture

- Runtime: Cloudflare Workers + Hono + TypeScript.
- Database: Neon PostgreSQL via `@neondatabase/serverless` HTTP driver; parameterized tagged-template queries only.
- UI: same-origin static SPA from `public/`; API requests run through the Worker.
- Identity: Cloudflare Access JWT (JWKS verification) or constant-time Bearer `API_TOKEN`.
- AI: draft assistant and Personal AI Assistant are advisory. Assistant chat, explicit memory CRUD, task tracking, and agent telemetry require migration `005_assistant.sql` and the `OPENAI_API_KEY` Worker secret. The assistant cannot approve purchases, contracts, payments, or send external messages.
- Operations: supplier and clinic CRUD endpoints live under `/api/ops`; all API routes require authentication. SQL migrations live in `migrations/`.

## UI (React + Motion)

Source in `ui/` (Vite, React 18, Motion). `npm run build:ui` writes the SPA to `public/`; the built output is committed so deploy needs no build step. Rebuild and commit `public/` after any UI change. Use `npm run dev:ui` for local development (proxies `/api` to Wrangler on port 8787).

## Local development

Use Node.js 22.12 or newer.

```sh
cd workspace
npm ci
npm test
npm run typecheck
npm run typecheck:ui
npm run build:ui
npm run dev
```

## Database migration

Apply SQL files in `migrations/` to the configured Neon database in ascending numeric order. `004_operations.sql` enables supplier/clinic operations; `005_assistant.sql` enables assistant conversations, messages, explicit memories, tasks, agent telemetry, and approval records. Review the target database, take a backup, and prepare a rollback plan before applying either migration. Do not deploy assistant API use until migration 005 is applied and `OPENAI_API_KEY` is configured as a Worker secret.

## Deployment safety

Never commit secrets or `.dev.vars`. Keep `EMAIL_SEND_MODE=dry-run` until the owner explicitly authorizes live email. Do not deploy live external side effects as part of tests.
