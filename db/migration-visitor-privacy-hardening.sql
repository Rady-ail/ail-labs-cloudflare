-- Phase 1A — visitor privacy hardening
-- Additive only. No DROP/rename and no photo purge is executed by this migration.

ALTER TABLE visitor_identities
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_visitor_identities_retention
  ON visitor_identities(retention_until);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON admin_audit_log(created_at DESC);

-- Existing location/GPS columns are intentionally NOT dropped.
-- Phase 1A application code stops writing location data.
-- Automatic photo deletion remains disabled until VISITOR_PHOTO_PURGE_ENABLED=true.
