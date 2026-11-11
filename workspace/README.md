# AIL LABS Workspace

Private B2B operations workspace for AIL LABS. This application is isolated under `workspace/` and deploys as the separate Cloudflare Worker `ail-labs-workspace`.

## Architecture

- Runtime: Cloudflare Workers + Hono + TypeScript.
- Database: Neon PostgreSQL via `@neondatabase/serverless` HTTP driver; parameterized tagged-template queries only.
- UI: same-origin static SPA from `public/`; API requests run through the Worker.
- Identity: Cloudflare Access JWT (JWKS verification) or constant-time Bearer `API_TOKEN`.
- Domains: `app.ail-aesthetic-labs.my.id` only. The route is a Cloudflare custom domain: on deploy, Cloudflare creates the DNS record for this one subdomain automatically (the zone must be on Cloudflare). Nameservers and other records are untouched.
- Email: Resend, Svix-verified webhook, approval-gated scheduled sending. Default mode is `dry-run`.
- AI: optional OpenAI integration is isolated behind `OPENAI_API_KEY`; AI may assist analysis and drafting but cannot approve purchases, contracts, payments, or send external messages. Draft requests are capped at 8 KiB, with up to 800 Unicode code points of trimmed source text. The `AI_RATE_LIMITER` Worker binding applies an approximate limit of 10 requests per actor and route per 60 seconds in each Cloudflare location; it is a best-effort throttle, not a strict global cap. Over-limit requests return the standard JSON error shape with status 429. If the limiter binding is unavailable, AI requests fail closed with status 503.

## UI (React + Motion)

Source in `ui/` (Vite, React 18, Motion). `npm run build:ui` writes the SPA to `public/`; the built output is committed so deploy needs no build step. Rebuild and commit `public/` after any change in `ui/`. Use `npm run dev:ui` for local development (proxies `/api` to wrangler on port 8787).

## Local development

Use Node.js 22.12 or newer for the workspace toolchain (Vitest 5).

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
