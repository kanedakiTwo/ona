-- PRO-21: explicit consent for health data (RGPD art. 9). Additive.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "health_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "health_consent_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "health_consent_withdrawn_at" timestamp with time zone;
