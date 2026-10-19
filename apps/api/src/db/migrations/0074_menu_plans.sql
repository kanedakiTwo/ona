CREATE TABLE "menu_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid,
	"mode" text DEFAULT 'shadow' NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"days" jsonb,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"check" jsonb,
	"planner_score" jsonb,
	"generator_score" jsonb,
	"candidates" integer DEFAULT 0 NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micros" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_plans_status_check" CHECK (status IN ('ok','partial','fallback','skipped'))
);
--> statement-breakpoint
ALTER TABLE "menu_plans" ADD CONSTRAINT "menu_plans_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plans" ADD CONSTRAINT "menu_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plans" ADD CONSTRAINT "menu_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_menu_plans_menu" ON "menu_plans" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "idx_menu_plans_household_created" ON "menu_plans" USING btree ("household_id","created_at");