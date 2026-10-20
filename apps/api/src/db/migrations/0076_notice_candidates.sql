-- PRO-215: every aviso Mimo could send by itself and what the weekly budget
-- did with it (sent, merged, dropped by the budget, outside Meta's window).
-- New table only (additive).
CREATE TABLE IF NOT EXISTS "notice_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_key" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"priority" integer NOT NULL,
	"outcome" text NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"channel" text,
	"week" text NOT NULL,
	"moment_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notice_candidates" ADD CONSTRAINT "notice_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notice_candidates_key_week" ON "notice_candidates" USING btree ("budget_key","week");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notice_candidates_user_created" ON "notice_candidates" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notice_candidates_week" ON "notice_candidates" USING btree ("week");
