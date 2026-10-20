CREATE TABLE "menu_planner_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"context" jsonb NOT NULL,
	"days" jsonb,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"check" jsonb,
	"planner_score" jsonb,
	"generator_score" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micros" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "menu_planner_run_items_status_check" CHECK (status IN ('pending','ok','partial','fallback','failed'))
);
--> statement-breakpoint
CREATE TABLE "menu_planner_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" text NOT NULL,
	"status" text NOT NULL,
	"batch_id" text,
	"model" text NOT NULL,
	"requested" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "menu_planner_runs_status_check" CHECK (status IN ('empty','submitted','ended','failed'))
);
--> statement-breakpoint
ALTER TABLE "menu_planner_run_items" ADD CONSTRAINT "menu_planner_run_items_run_id_menu_planner_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."menu_planner_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_planner_run_items" ADD CONSTRAINT "menu_planner_run_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_planner_run_items" ADD CONSTRAINT "menu_planner_run_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_menu_planner_run_items_run_household" ON "menu_planner_run_items" USING btree ("run_id","household_id");--> statement-breakpoint
CREATE INDEX "idx_menu_planner_run_items_household" ON "menu_planner_run_items" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_menu_planner_runs_week" ON "menu_planner_runs" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "idx_menu_planner_runs_status" ON "menu_planner_runs" USING btree ("status");