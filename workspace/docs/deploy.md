# Deployment

1. Verify the Cloudflare account and free-plan eligibility before creating/deploying resources.
2. Create only the Worker `ail-labs-workspace` from this config.
3. Provision Worker secrets interactively; do not touch any existing Worker.
4. Keep `EMAIL_SEND_MODE=dry-run`.
5. Attach only `app.ail-aesthetic-labs.my.id` as the custom domain for this Worker. Do not change nameservers or existing DNS records.
6. Configure Cloudflare Access for the hostname and validate JWT audience/team domain.
7. Deploy only after tests and typecheck pass.
8. Verify `GET /api/health` returns HTTP 200 with `{ "ok": true, "db": true, "time": "..." }`.

The frontend build will replace the placeholder in `public/` in a later reviewed commit.
