-- AIL LABS RFQ persistence — Phase 1
-- Additive/idempotent only. No production columns are dropped or renamed.
-- Apply to Neon PostgreSQL before enabling the RFQ persistence path.

CREATE TABLE IF NOT EXISTS rfq_requests (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  position TEXT,
  whatsapp TEXT NOT NULL,
  email TEXT NOT NULL,
  nib TEXT,
  customer_category TEXT,
  product TEXT,
  quantity TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'website-quotation',
  email_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rfq_requests_status_allowed CHECK (
    status IN ('new','email_sent','email_failed','qualified','quoted','negotiation','approved','ordered','rejected')
  ) NOT VALID
);

CREATE INDEX IF NOT EXISTS idx_rfq_requests_status_created
  ON rfq_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfq_requests_email_created
  ON rfq_requests(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfq_requests_company_created
  ON rfq_requests(company, created_at DESC);

COMMENT ON TABLE rfq_requests IS 'AIL LABS B2B RFQ lifecycle; Phase 1 additive persistence.';
