-- PRO-334: the Sean Ellis survey (beta). Only adds nullable columns.
ALTER TABLE "user_feedback" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sean_ellis_at" timestamp with time zone;
