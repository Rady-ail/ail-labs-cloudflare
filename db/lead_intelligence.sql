-- AIL LABS B2B Lead Intelligence (additive/idempotent)
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS interest_category TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS lead_source TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS landing_page TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS lead_score INTEGER NOT NULL DEFAULT 20;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'New';
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE lead_captures ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_lead_captures_score ON lead_captures(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_captures_status ON lead_captures(status);
CREATE INDEX IF NOT EXISTS idx_lead_captures_source ON lead_captures(lead_source);
