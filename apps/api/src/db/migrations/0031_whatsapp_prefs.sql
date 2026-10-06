-- Per-kind switches for proactive WhatsApp messages ({ daily_brief: false }…).
-- Missing key = on. Idempotent.
ALTER TABLE "whatsapp_links" ADD COLUMN IF NOT EXISTS "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;
