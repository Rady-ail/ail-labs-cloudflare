# AIL LABS Workspace

Private B2B operations workspace for AIL LABS. This application is isolated under `workspace/` and deploys as the separate Cloudflare Worker `ail-labs-workspace`.

## Architecture

- Runtime: Cloudflare Workers + Hono + TypeScript.
- Database: Neon PostgreSQL via `@neondatabase/serverless` HTTP driver; parameterized tagged-template queries only.
- UI: same-origin static SPA from `public/`; API requests run through the Worker.
- Identity: Cloudflare Access JWT (JWKS verification) or constant-time Bearer `API_TOKEN`.
- Domains: `app.ail-aesthetic-labs.my.id` only. No DNS or nameserver changes are part of this repository change.
- Email: Resend, Svix-verified webhook, approval-gated scheduled sending. Default mode is `dry-run`.
- AI: optional OpenAI integration is isolated behind `OPENAI_API_KEY`; AI may assist analysis and drafting but cannot approve purchases, contracts, payments, or send external messages.

## Local development

```sh
cd workspace
npm install
npm test
npm run typecheck
npm run dev
```

## Deployment safety

Never commit secrets or `.dev.vars`. Keep `EMAIL_SEND_MODE=dry-run` until Rady explicitly changes the Worker variable to `live`. Do not deploy a live email path as part of tests.

See `docs/architecture.md`, `docs/secrets.md`, and `docs/deploy.md`.
