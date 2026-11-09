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
