# Automation — what runs, and where it came from

Applied 2026-11-09 from five uploaded reference repos. Only patterns that fit this repo's rules
(public repo, no new dependencies, approval boundary, no autonomous network transmission) were adopted.

## What runs automatically
| Trigger | Mechanism | Effect |
|---|---|---|
| Claude session start/resume/compact | `.claude/settings.json` → `.claude/hooks/ail-guard.js session-start` | Injects branch, dirty count, approval rules, last 5 local memories |
| Claude Bash call | `pre-bash` | **Ask** before: push to main / force push, `wrangler deploy`, Cloudflare secret/data writes, `DROP`/`TRUNCATE`/`DELETE` without `WHERE`, `rm -rf` on root/repo/data, `git reset --hard`/`clean -f`, `curl \| sh`, `npm install <new-pkg>` |
| Claude Edit/Write | `pre-write` | **Deny** secrets in any tracked file; **deny** tokens from `scripts/validate-build.js` forbidden list in `public/`/`prototypes/`; **ask** on non-company emails or 16-digit numbers there |
| Claude Edit/Write | `post-write` | Runs static integrity audit when `public/`, `prototypes/`, `validate-build.js` or `deploy.yml` change and blocks on failure; advisory hints for XSS/SQL/command injection/Actions injection and BPOM-sensitive overclaims ("menyembuhkan", "tanpa efek samping", "clinically proven", ...) |
| Pull request to `main`, push to `main` | `validate-pr.yml`, `deploy.yml` | `npm run build` + `npm test` (catalog agent + guard/memory tests) before deploy |

The guard fails **open** on its own crash (logs to stderr) and **closed** on a detected risk.
"Ask" means the user approves in the permission prompt — the hook never approves anything itself.
Claim hints are advisory, not legal advice: verify against current BPOM guidance before publishing.

## Manual tools
- `npm run memory -- add "fakta" --source "sumber" --kind user|inferred [--supersedes mN]`, `search`, `list [--all]`, `forget mN` (deletes and verifies).
  Store: `.claude/memory/memory.jsonl`, **gitignored** because the repo is public; redacts secrets, emails, phones, long numbers; dedupes; supersede keeps history. Override path with `AIL_MEMORY_FILE`.
- Skill `site-qa` (`.claude/skills/site-qa/`): `npm run build`, serve `public/`, `node .claude/skills/site-qa/smoke.js <base-url>` → desktop + mobile pass/fail, console errors, horizontal overflow, screenshots. `/api/*` failures are reported separately (need `wrangler dev`).

## Source → decision (license verified from each upstream LICENSE file in the upload)
| Upload | License | Adopted | Not adopted (why) |
|---|---|---|---|
| anthropics/skills | Apache-2.0 per skill | `webapp-testing` pattern → `site-qa` (LICENSE copied) | docx/pdf/pptx/xlsx/skill-creator already available as user skills |
| claude-mem | Apache-2.0 | Lifecycle-hook memory concept → `scripts/memory.js` + SessionStart surfacing | Plugin itself: background worker, SQLite, sends observations to a remote model — violates "no autonomous external network transmission" |
| claude-skills (A. Rezvani) | MIT | `security-guidance` hook idea (PreToolUse anti-pattern scan), `human-gate` principle (agent never approves its own work) → ask-decisions | 200+ skills not copied; regulatory skills (ISO 13485, MDR, FDA) are EU/US-centric — BPOM facts must come from current Indonesian sources |
| claude-quickstarts | MIT | Reference only (agent loops, autonomous-coding verify-before-done) | Demo apps not relevant to the site |
| awesome-claude-code | CC BY-NC-ND 4.0 | Used as a reading list only | No derivative content may be copied |

## Change / rollback
Edit rules in `.claude/hooks/ail-guard.js`, add a case to `test/ail-guard.test.js`, run `npm test`.
To disable hooks locally without a commit, override in `.claude/settings.local.json` (gitignored).
To remove: delete the `hooks` block in `.claude/settings.json`.
