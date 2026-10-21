-- PRO-317 (D-110): «Aprender de lo que hago» per person, and the answers to the ficha's pending question. Only adds columns.
ALTER TABLE "profile_questions" ADD COLUMN IF NOT EXISTS "answer" text;--> statement-breakpoint
ALTER TABLE "profile_questions" ADD COLUMN IF NOT EXISTS "answered_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_learning_paused_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "profile_questions" ADD CONSTRAINT "profile_questions_answered_by_user_id_users_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
