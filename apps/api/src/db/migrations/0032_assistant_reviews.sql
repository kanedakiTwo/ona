-- Daily WhatsApp conversation review (services/whatsapp/reviewer.ts) and
-- per-turn metadata it reads. New table + nullable column; idempotent.
CREATE TABLE IF NOT EXISTS "assistant_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" text NOT NULL,
	"status" text NOT NULL,
	"stats" jsonb,
	"findings" jsonb,
	"summary" text,
	"model" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_reviews_day_unique" UNIQUE("day")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "meta" jsonb;
