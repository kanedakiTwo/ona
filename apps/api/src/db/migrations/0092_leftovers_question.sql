-- PRO-285: Mimo's one-time question about leftovers (WhatsApp beta). Only adds columns.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "leftovers_question_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_feedback" ADD COLUMN IF NOT EXISTS "tag" text;
