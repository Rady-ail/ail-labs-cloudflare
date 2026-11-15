# AIL LABS Workspace

Private B2B operations workspace for AIL LABS. This application is isolated under `workspace/` and deploys as the separate Cloudflare Worker `ail-labs-workspace`.

## Architecture

- Runtime: Cloudflare Workers + Hono + TypeScript.
- Database: Neon PostgreSQL via `@neondatabase/serverless` HTTP driver; parameterized tagged-template queries only.
- UI: same-origin static SPA from `public/`; API requests run through the Worker.
- Identity: Cloudflare Access JWT (JWKS verification) or constant-time Bearer `API_TOKEN`.
- AI: draft assistant and Personal AI Assistant are advisory. Assistant chat, explicit memory CRUD, task tracking, and agent telemetry require migration `005_assistant.sql` and the `OPENAI_API_KEY` Worker secret. The assistant cannot approve purchases, contracts, payments, or send external messages.
- Operations: supplier and clinic CRUD endpoints live under `/api/ops`; all API routes require authentication. SQL migrations live in `migrations/`.

## UI (React + Motion)

Source in `ui/` (Vite, React 18, Motion). `npm run build:ui` writes the SPA to `public/`; the built output is committed so deploy needs no build step. Rebuild and commit `public/` after any UI change. Use `npm run dev:ui` for local development (proxies `/api` to Wrangler on port 8787).

## Fitur operasional

- **Beranda:** ringkasan klinik/supplier per status, jumlah tindak lanjut terlambat, dan daftar tindak lanjut terdekat (`GET /api/ops/summary`, `/api/ops/followups`).
- **Aktivitas & tindak lanjut:** catatan, WhatsApp, telepon, pertemuan, sampel dengan jatuh tempo per supplier/klinik (`/api/ops/activities`, tabel `workspace_activities` dari migrasi 004; tanpa migrasi baru).
- **Daftar:** pencarian, filter status, ekspor CSV (tameng injeksi rumus), dan tombol WhatsApp yang hanya membuka chat (tidak mengirim otomatis).
- **Landed Cost:** hitung biaya mendarat, margin, dan salin ringkasan.
- **Personal Assistant & Draf AI:** advisory saja, dengan pagar persetujuan dan rate limit.
- **PWA:** manifest, ikon, dan service worker (hanya cangkang aplikasi; `/api/*` tidak pernah disimpan) sehingga bisa dipasang di Android lewat "Tambahkan ke layar utama".

## Local development

Use Node.js 22.12 or newer.

```sh
cd workspace
npm ci
npm test
npm run typecheck
npm run typecheck:ui
npm run build:ui
npm run dev
```

## Database migration

Apply SQL files in `migrations/` to the configured Neon database in ascending numeric order. `004_operations.sql` enables supplier/clinic operations; `005_assistant.sql` enables assistant conversations, messages, explicit memories, tasks, agent telemetry, and approval records. Review the target database, take a backup, and prepare a rollback plan before applying either migration. Do not deploy assistant API use until migration 005 is applied and `OPENAI_API_KEY` is configured as a Worker secret.

`006_sop_gates_quotes.sql` (additive, idempotent) adds the supplier `sop_stage` column, per-supplier gates (halal, LoA BPOM, CFS, COA/ISO, safe payment), and saved landed-cost quotes. Until it is applied, the `/api/proc/*` endpoints return a safe 503 and the UI shows a hint; existing `/api/ops/*` features are unaffected. Take a backup first.

## Deployment safety

Never commit secrets or `.dev.vars`. Keep `EMAIL_SEND_MODE=dry-run` until the owner explicitly authorizes live email. Do not deploy live external side effects as part of tests.

## Fase 1: meja kerja harian

- **Hari ini** (layar pertama): tindak lanjut terlambat atau jatuh tempo hari ini (zona WITA), persetujuan asisten yang menunggu (khusus pengguna), dokumen supplier yang diminta tetapi belum diterima, dan jumlah supplier tertahan. Tiap bagian diambil sendiri (`GET /api/proc/today`), sehingga satu tabel yang belum dimigrasi tidak mengosongkan bagian lain.
- **Tahap SOP dan gerbang supplier**: tombol "Gerbang" pada baris supplier. Hanya mencatat status dan sumber; tidak mengirim apa pun. Tahap SOP (aktif, tertahan, berhenti, ditutup) terpisah dari kolom `status` lama.
- **Landed cost tersimpan dan banding**: rumus tunggal di `src/lib/landed.ts` dipakai server dan UI; server menghitung ulang angkanya dan tidak mempercayai total dari klien. Penawaran dikelompokkan per produk, termurah dulu.
- Rebuild dan commit `public/` setelah perubahan UI.
