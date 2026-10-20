-- PRO-237: the «Avisos» screen's switch per alert kind (missing key = on).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "alert_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;
