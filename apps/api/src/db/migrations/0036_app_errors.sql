-- In-house error tracker (specs/errors.md): one row per error group, keyed
-- by fingerprint (kind + normalised message + top stack frame). Written by
-- services/appErrors.ts from POST /client-errors and from API 5xx responses.
-- New table only; idempotent so a partial apply can be re-run safely.
CREATE TABLE IF NOT EXISTS "app_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"sample_stack" text,
	"sample_path" text,
	"release" text,
	"user_agent_family" text,
	"last_user_id" uuid,
	"count" bigint DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "app_errors_kind_check" CHECK (kind IN ('client','server')),
	CONSTRAINT "app_errors_last_user_id_users_id_fk" FOREIGN KEY ("last_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_errors_fingerprint" ON "app_errors" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_errors_last_seen" ON "app_errors" USING btree ("last_seen");
