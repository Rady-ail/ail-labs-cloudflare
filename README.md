# AIL LABS — B2B Sales & Procurement OS
Cloudflare Workers + Hono + D1 + KV, vanilla frontend.

## Deploy via Cloudflare Dashboard
1. Connect this repository in Workers & Pages → Create application → Connect to Git.
2. Select `main`, build command `npm run build`, and deploy; static assets are `public/`.
3. Create D1 and KV, bind them as `DB` and `RATE_LIMIT`; set their IDs in dashboard/config.
4. Apply `migrations/0001_core.sql` and later migrations to D1.
5. Add the first admin using the bootstrap SQL below, then verify `/api/health`.

## Variables / secrets
Required bindings: `DB`, `RATE_LIMIT`.
Variables: `PUBLIC_BASE_URL`, `RESEND_FROM`, `MAIL_ALERT_TO`, `TURNSTILE_SITE_KEY`.
Secrets: `RESEND_API_KEY`, `TURNSTILE_SECRET`.
No API token or wrangler login is required for this Git-connected deployment.

## First admin
Generate a SHA-256 password hash locally and insert:
`INSERT INTO admin_users(id,username,password_hash) VALUES('UUID','OWNER_USERNAME','SHA256_HEX');`
Only the hash is stored.

## Local
`npm install`
`npm test`
`npm run build`
`npx wrangler d1 migrations apply DB --local`
`npm run dev`

## Phase 0–1
Public catalog → consent lead → server scoring → RFQ → admin pipeline → CSV → hourly alert scaffold.

## Public contact
info@ail-aesthetic-labs.my.id — Banjarmasin, Kalimantan Selatan.

## Privacy
No silent camera/location collection. Human verification is Turnstile. Email OTP is the Phase 1 contact verification path; WhatsApp is click-to-chat only. Add a public privacy policy page before production promotion.
