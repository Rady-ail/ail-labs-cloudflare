ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS message_id TEXT;
CREATE INDEX IF NOT EXISTS email_messages_message_id_idx ON email_messages (message_id) WHERE message_id IS NOT NULL;
ALTER TABLE email_drafts DROP CONSTRAINT IF EXISTS email_drafts_status_check;
ALTER TABLE email_drafts ADD CONSTRAINT email_drafts_status_check CHECK (status IN ('draft','needs_ok','scheduled','sent','cancelled','failed'));
