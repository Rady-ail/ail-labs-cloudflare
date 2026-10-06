# AIL LABS — Repository Rules

## Scope
These rules apply to redesign and frontend maintenance work in this repository.

## Files and paths that must not be modified for UI redesign
- `public/admin/**`
- `public/images/**` (catalog/product assets)
- `public/vendor/**`
- `routes/**`
- `services/**`
- `db/**`
- `app.js`
- `server.js`
- `package.json`
- `package-lock.json`
- `wrangler.jsonc`
- `.github/workflows/**`
- Any `.env*`, `*.pem`, `*.key`, or secret/config files containing credentials.

Do not add dependencies for a visual redesign unless explicitly approved.

## Secrets
- Never print, echo, paste, commit, or expose API keys, OAuth secrets, database URLs, tokens, private keys, or runtime secret values.
- Never inspect secret values merely for debugging.
- Redact secrets from logs and reports.

## Destructive commands
Never use:
- `rm -rf`
- `git reset --hard`
- force push
- `git clean -fd`
- `chmod 777`
- database `DROP` / `TRUNCATE`

Use reversible Git commits and `git revert <commit>` for rollback.

## Redesign workflow
1. Inspect the smallest necessary surface.
2. Make one logical change per commit.
3. Preserve existing React/Babel behavior, API calls, authentication, catalog data, payment flow, admin behavior, and deployment configuration.
4. Keep redesign CSS tokenized and centralized.
5. Prefer CSS transform/opacity motion only; respect `prefers-reduced-motion`.
6. Run static verification after changes.
7. Runtime/build checks must be labeled honestly when they cannot be run in the current environment.

## Verification for this repository
When a local runtime is available:
- `find . -name "*.js" -not -path "./node_modules/*" -not -path "./public/vendor/*" -exec node --check {} \\\;`
- Search for references to removed legacy files.
- Run `npm start`.
- Check homepage, catalog, admin/login, and relevant API endpoints.
- Check browser console and asset 404s.
- Confirm responsive behavior at 360, 768, 1280, and 1920px.
- Check reduced-motion behavior.

When no runtime is available:
- Verify HTML structure statically.
- Verify local asset references against repository paths.
- Verify no legacy theme tokens/selectors remain in active CSS.
- Verify required color tokens and contrast intent.
- Verify only intended files changed.
- State clearly which runtime checks were not performed.

## Branch safety
- Do not merge redesign branches into `main` without explicit approval.
- Do not delete branches unless explicitly requested.
