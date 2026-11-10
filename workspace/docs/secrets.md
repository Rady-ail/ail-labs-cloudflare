# Worker secrets

Set secrets only on the new Worker `ail-labs-workspace`. Never put secret values in chat, Git, source files, `vars`, or logs.

Required secrets:
- `DATABASE_URL`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `API_TOKEN`

Optional secret for the AI advisory module:
- `OPENAI_API_KEY`

Non-secret Worker variables:
- `EMAIL_SEND_MODE=dry-run` (must remain the initial production default)
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `OPENAI_MODEL` (only if an approved model choice is made)

After authenticating Wrangler to the correct Cloudflare account, run these from `workspace/`:

```sh
npx wrangler secret put DATABASE_URL --config wrangler.jsonc
npx wrangler secret put RESEND_API_KEY --config wrangler.jsonc
npx wrangler secret put RESEND_WEBHOOK_SECRET --config wrangler.jsonc
npx wrangler secret put API_TOKEN --config wrangler.jsonc
npx wrangler secret put OPENAI_API_KEY --config wrangler.jsonc
```

Enter each value only in Wrangler's interactive prompt. Do not paste it into terminal commands, shell history, or chat. If Access JWT authentication is used, set the non-secret `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` under Worker Variables in Cloudflare. Keep the Bearer path available only as an explicitly provisioned fallback.
