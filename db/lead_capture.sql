-- AIL LABS verified visitor lead capture
CREATE TABLE IF NOT EXISTS lead_captures (
 id SERIAL PRIMARY KEY, session_id TEXT, name TEXT NOT NULL, company TEXT NOT NULL, phone TEXT NOT NULL,
 email TEXT NOT NULL, email_verified_at TIMESTAMPTZ NOT NULL, consent_at TIMESTAMPTZ NOT NULL,
 marketing_consent BOOLEAN NOT NULL DEFAULT false, lead_token_hash TEXT UNIQUE NOT NULL, ip_address TEXT,
 country TEXT, region TEXT, city TEXT, user_agent TEXT, first_page TEXT, referrer TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_captures_email ON lead_captures(email);
CREATE INDEX IF NOT EXISTS idx_lead_captures_created_at ON lead_captures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_captures_country ON lead_captures(country);
CREATE TABLE IF NOT EXISTS lead_email_otps (
 id SERIAL PRIMARY KEY, email TEXT NOT NULL, otp_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, request_ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lead_otps_email_created ON lead_email_otps(email, created_at DESC);
