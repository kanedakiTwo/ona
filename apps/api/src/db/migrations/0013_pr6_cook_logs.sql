CREATE TABLE "cook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid,
	"recipe_id" uuid NOT NULL,
	"menu_id" uuid,
	"day_index" integer,
	"meal" text,
	"cooked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_min" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cook_logs" ADD CONSTRAINT "cook_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_logs" ADD CONSTRAINT "cook_logs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_logs" ADD CONSTRAINT "cook_logs_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_logs" ADD CONSTRAINT "cook_logs_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cook_logs_household_cooked" ON "cook_logs" USING btree ("household_id","cooked_at");--> statement-breakpoint
CREATE INDEX "idx_cook_logs_recipe" ON "cook_logs" USING btree ("recipe_id");