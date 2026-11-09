# API security controls

- Global response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, empty `Permissions-Policy: ()`, `Referrer-Policy: no-referrer`, restrictive CSP, and HSTS only when the request URL is HTTPS. Headers are set before route handling so API errors also receive them.
- Mutating API methods require the exact application origin `https://app.ail-aesthetic-labs.my.id`. HTTP localhost/127.0.0.1 origins are accepted only when runtime `DEV=1`. The Resend webhook is exempt from origin checks because it verifies the Svix signature.
- Every non-CRM API request body is counted from the actual cloned request stream and rejected above 256 KiB; this does not trust `Content-Length`. CRM mutation handlers use `readJsonObject`, which independently counts actual streamed bytes and applies the same 256 KiB default. The Resend webhook independently reads/counts the raw body and rejects above 1 MiB.
- API requests are limited to 120 requests per 60-second window per IP plus SHA-256 hash of the presented bearer token or Cloudflare Access JWT or Cloudflare Access JWT. The webhook is exempt.
- The rate limiter is an in-memory Map scoped to a Worker isolate. It is best-effort, resets on isolate restart, and is not globally coordinated across concurrent isolates/locations. The map prunes expired buckets and caps retained entries at 10,000. It is not a substitute for a Cloudflare Rate Limiting binding/WAF policy; no such binding is configured in this Worker. Worker Free plan limits/features may constrain available platform-level rate-limiting controls, so do not treat this Map as a hard abuse or billing boundary.
- Application code contains no `console.log`/`console.error` statements. Error handling returns generic internal errors rather than stack traces or SQL details. Audit events store structured metadata (actor/action/resource type/id/request id/success), not message bodies, phone numbers, tokens, or secrets.

# Worker secrets and runtime configuration

`wrangler.jsonc` intentionally keeps only non-secret configuration in `vars`:

- `EMAIL_SEND_MODE`: `dry-run` (required safe default).

No credentials, tokens, connection strings, or webhook secrets belong in `vars`, source files, or committed `.env` files.

Rady/operator provisions secrets interactively from `workspace/` using Wrangler:

```sh
wrangler secret put DATABASE_URL --config wrangler.jsonc
wrangler secret put RESEND_API_KEY --config wrangler.jsonc
wrangler secret put RESEND_WEBHOOK_SECRET --config wrangler.jsonc
wrangler secret put API_TOKEN --config wrangler.jsonc
```

Optional Cloudflare Access settings are also secret/runtime configuration if enabled:

```sh
wrangler secret put CF_ACCESS_TEAM_DOMAIN --config wrangler.jsonc
wrangler secret put CF_ACCESS_AUD --config wrangler.jsonc
```

Do not paste secret values into chat, source code, logs, or GitHub. Confirm the target Worker/environment before each secret operation. `API_TOKEN` is optional only when Cloudflare Access is configured and verified as the authentication path; otherwise it is required by the bearer-token path. Keep `EMAIL_SEND_MODE=dry-run`; live mode requires Rady's explicit approval.
