# AIL LABS — Cloudflare Workers Deployment

This package is prepared from the AIL LABS catalog source for Cloudflare Workers.

## Build/deploy
- `npm install`
- `npx wrangler dev`
- `npx wrangler deploy`

## Static assets
- Served from `public/` via `wrangler.jsonc`.
- `/api/*` is handled by the Worker.

## Secrets
Set runtime secrets/variables in Cloudflare; do not commit `.env`.
At minimum, review the variables in `.env.example` before production.

## Custom domain
After the Worker is deployed, attach `ail-aesthetic-labs.my.id` as a Custom Domain in Cloudflare Workers > Settings > Domains & Routes.
