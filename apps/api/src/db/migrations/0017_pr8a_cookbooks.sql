CREATE TABLE "cookbook_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cookbook_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cookbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"emoji" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cookbook_recipes" ADD CONSTRAINT "cookbook_recipes_cookbook_id_cookbooks_id_fk" FOREIGN KEY ("cookbook_id") REFERENCES "public"."cookbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_recipes" ADD CONSTRAINT "cookbook_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbooks" ADD CONSTRAINT "cookbooks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cookbook_recipes_cookbook_recipe" ON "cookbook_recipes" USING btree ("cookbook_id","recipe_id");--> statement-breakpoint
CREATE INDEX "idx_cookbook_recipes_recipe" ON "cookbook_recipes" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "idx_cookbooks_household" ON "cookbooks" USING btree ("household_id");