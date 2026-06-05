-- Per-user monthly spend cap for the text advisor (POST /assistant/:userId/chat).
-- `advisor_spend_month_key` is the YYYY-MM the running total belongs to; on the
-- first chat of a new month the total resets atomically (same stateless pattern
-- as the image-generation quota). Spend is accumulated in micro-euros (1e-6 €).
-- Idempotent so a partial apply can be re-run safely.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "advisor_spend_month_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "advisor_spend_micros" bigint DEFAULT 0 NOT NULL;
