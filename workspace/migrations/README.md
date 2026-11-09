# Workspace database migrations

Apply migrations in this exact order:

1. `001_email.sql`
2. `002_crm.sql`
3. `003_audit.sql`
4. `004_email_webhook_sender.sql`

## Reviewed application procedure

These files are source-controlled migration records; they are **not** executed automatically by the Worker.

1. Confirm the target Neon project, branch, database, and current schema with a read-only inspection.
2. Review the exact SQL diff and compare it with the target database's `information_schema`, constraints, and indexes.
3. Obtain explicit Rady approval for the specific DDL and target.
4. Run the approved migration through the team's reviewed Neon migration process, with transaction/error-stop behavior where supported.
5. Re-inspect columns, types, constraints, and indexes; record the migration hash and verification evidence.
6. Never apply a migration to production merely because a file exists in this directory.

## Important: migration 004

`004_email_webhook_sender.sql` adds `email_messages.message_id` and its partial index, then drops and recreates `email_drafts_status_check` to include the `failed` status. This changes the allowed status constraint. Review the existing status values and constraint before applying; do not run it blindly.

Migration 001 and 002 source files must be restored from their authoritative source before the sequence is considered complete. Do not reconstruct or substitute them from the live schema.
