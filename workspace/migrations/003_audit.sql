-- 003_audit.sql: additive audit trail; safe to apply repeatedly.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  ok BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_resource_type_resource_id_idx
  ON public.audit_log (resource_type, resource_id);
