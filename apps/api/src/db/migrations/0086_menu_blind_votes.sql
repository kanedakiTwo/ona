CREATE TABLE "menu_blind_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid,
	"label" text NOT NULL,
	"preferred" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_blind_votes_label_check" CHECK (label IN ('A','B','igual')),
	CONSTRAINT "menu_blind_votes_preferred_check" CHECK (preferred IN ('planner','generator','tie'))
);
--> statement-breakpoint
ALTER TABLE "menu_plans" ADD COLUMN "generator_days" jsonb;--> statement-breakpoint
ALTER TABLE "menu_blind_votes" ADD CONSTRAINT "menu_blind_votes_plan_id_menu_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."menu_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_blind_votes" ADD CONSTRAINT "menu_blind_votes_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_blind_votes" ADD CONSTRAINT "menu_blind_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_blind_votes" ADD CONSTRAINT "menu_blind_votes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_menu_blind_votes_plan_user" ON "menu_blind_votes" USING btree ("plan_id","user_id");