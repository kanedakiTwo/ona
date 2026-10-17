-- PRO-136: founder price on the subscription (from Stripe metadata), the legal
-- notice 15 days before the first charge, and the day-7 offer (each once).
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "founder_price" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "charge_notice_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "founder_offer_at" timestamp with time zone;
