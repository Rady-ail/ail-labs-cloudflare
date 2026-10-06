-- AIL LABS WhatsApp compliance schema migration placeholder.
-- Additive/idempotent migration; production execution is required before pilot sending.
ALTER TABLE pelanggan_broadcast ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pelanggan_broadcast ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ;
ALTER TABLE pelanggan_broadcast ADD COLUMN IF NOT EXISTS whatsapp_opt_in_source TEXT;
ALTER TABLE pelanggan_broadcast ADD COLUMN IF NOT EXISTS whatsapp_opt_out_at TIMESTAMPTZ;
ALTER TABLE broadcast_campaigns ADD COLUMN IF NOT EXISTS wa_template_name TEXT;
ALTER TABLE broadcast_campaigns ADD COLUMN IF NOT EXISTS wa_template_language TEXT;
ALTER TABLE broadcast_campaigns ADD COLUMN IF NOT EXISTS wa_template_params JSONB NOT NULL DEFAULT '[]'::jsonb;
