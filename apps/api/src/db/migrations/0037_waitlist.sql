-- Pre-launch waitlist (specs/waitlist.md): one row per person who signed up
-- on the public landing (POST /waitlist). No health data. Unsubscribing
-- anonymises the row (email/first_name/supermarket → NULL, newsletter off),
-- so `email` is nullable and its unique index tolerates several NULLs.
-- The newsletter opt-in is a separate, optional consent (LSSI art. 21–22).
-- New table only; idempotent so a partial apply can be re-run safely.
CREATE TABLE IF NOT EXISTS "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"first_name" text,
	"household_size" text NOT NULL,
	"planner_role" text NOT NULL,
	"current_method" text NOT NULL,
	"supermarket" text,
	"platform" text NOT NULL,
	"wants_whatsapp" boolean DEFAULT false NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by_code" text,
	"source" text DEFAULT 'directo' NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"consent_version" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"newsletter_opt_in" boolean DEFAULT false NOT NULL,
	"newsletter_consent_at" timestamp with time zone,
	"newsletter_consent_version" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"batch" integer,
	"invited_at" timestamp with time zone,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_entries_household_size_check" CHECK (household_size IN ('1','2','3-4','5+')),
	CONSTRAINT "waitlist_entries_planner_role_check" CHECK (planner_role IN ('yo','otra_persona','compartido')),
	CONSTRAINT "waitlist_entries_current_method_check" CHECK (current_method IN ('improviso','lista','app','menu_fijo','no_cocino')),
	CONSTRAINT "waitlist_entries_platform_check" CHECK (platform IN ('ios','android','otro')),
	CONSTRAINT "waitlist_entries_status_check" CHECK (status IN ('waiting','invited','joined','unsubscribed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_waitlist_entries_email" ON "waitlist_entries" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_waitlist_entries_referral_code" ON "waitlist_entries" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_waitlist_entries_unsubscribe_token" ON "waitlist_entries" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_waitlist_entries_referred_by" ON "waitlist_entries" USING btree ("referred_by_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_waitlist_entries_status_created" ON "waitlist_entries" USING btree ("status","created_at");
