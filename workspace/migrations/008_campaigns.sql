BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',

  subject TEXT,
  body TEXT NOT NULL,

  product_ids UUID[] NOT NULL DEFAULT '{}',
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,

  scheduled_at TIMESTAMPTZ,
  daily_limit INTEGER NOT NULL DEFAULT 150,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_channel_check
    CHECK (channel IN ('email', 'whatsapp')),

  CONSTRAINT campaigns_status_check
    CHECK (status IN (
      'draft',
      'siap',
      'dijadwalkan',
      'selesai',
      'dibatalkan'
    )),

  CONSTRAINT campaigns_daily_limit_check
    CHECK (daily_limit BETWEEN 1 AND 500),

  CONSTRAINT campaigns_products_array_check
    CHECK (
      cardinality(product_ids) <= 100
    ),

  CONSTRAINT campaigns_audience_object_check
    CHECK (
      jsonb_typeof(audience_filter) = 'object'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  campaigns_name_lower_unique_idx
  ON campaigns (lower(name));

CREATE INDEX IF NOT EXISTS
  campaigns_status_created_idx
  ON campaigns (status, created_at DESC);

CREATE INDEX IF NOT EXISTS
  campaigns_channel_idx
  ON campaigns (channel);

CREATE INDEX IF NOT EXISTS
  campaigns_scheduled_idx
  ON campaigns (scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  campaign_id UUID NOT NULL
    REFERENCES campaigns(id) ON DELETE CASCADE,

  clinic_id UUID NOT NULL
    REFERENCES clinics(id) ON DELETE CASCADE,

  state TEXT NOT NULL,
  reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT campaign_recipients_state_check
    CHECK (state IN (
      'antre',
      'dilewati',
      'terkirim_simulasi'
    )),

  CONSTRAINT campaign_recipients_unique
    UNIQUE (campaign_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS
  campaign_recipients_campaign_idx
  ON campaign_recipients (campaign_id, state);

CREATE INDEX IF NOT EXISTS
  campaign_recipients_clinic_idx
  ON campaign_recipients (clinic_id);

COMMIT;
