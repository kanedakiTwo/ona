CREATE TABLE "profile_refinements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"billed_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discarded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "profile_refinements_status_check" CHECK (status IN ('pending','applied','failed'))
);
--> statement-breakpoint
CREATE TABLE "profile_refiner_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" text NOT NULL,
	"kind" text DEFAULT 'nightly' NOT NULL,
	"status" text NOT NULL,
	"batch_id" text,
	"model" text NOT NULL,
	"requested" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "profile_refiner_runs_status_check" CHECK (status IN ('empty','submitted','ended','failed'))
);
--> statement-breakpoint
ALTER TABLE "profile_refinements" ADD CONSTRAINT "profile_refinements_run_id_profile_refiner_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."profile_refiner_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_refinements" ADD CONSTRAINT "profile_refinements_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_refinements" ADD CONSTRAINT "profile_refinements_billed_user_id_users_id_fk" FOREIGN KEY ("billed_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_profile_refinements_run_household" ON "profile_refinements" USING btree ("run_id","household_id");--> statement-breakpoint
CREATE INDEX "idx_profile_refinements_household" ON "profile_refinements" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_profile_refiner_runs_day_kind" ON "profile_refiner_runs" USING btree ("day","kind");--> statement-breakpoint
CREATE INDEX "idx_profile_refiner_runs_status" ON "profile_refiner_runs" USING btree ("status");