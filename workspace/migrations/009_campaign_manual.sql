BEGIN;

-- Menambah status "terkirim_manual": operator mengirim sendiri lewat WhatsApp lalu mencatatnya di aplikasi.
-- Aplikasi TIDAK mengirim pesan apa pun.
ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_state_check;
ALTER TABLE campaign_recipients ADD CONSTRAINT campaign_recipients_state_check
  CHECK (state IN ('antre', 'dilewati', 'terkirim_simulasi', 'terkirim_manual'));

COMMIT;
