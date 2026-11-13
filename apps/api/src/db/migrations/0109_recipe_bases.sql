-- PRO-373: bases de batch cooking. Only adds a table.
CREATE TABLE IF NOT EXISTS "recipe_bases" (
	"recipe_id" uuid NOT NULL,
	"base_recipe_id" uuid NOT NULL,
	"servings_used" real NOT NULL,
	CONSTRAINT "recipe_bases_recipe_id_base_recipe_id_pk" PRIMARY KEY("recipe_id","base_recipe_id"),
	CONSTRAINT "recipe_bases_servings_check" CHECK (servings_used > 0),
	CONSTRAINT "recipe_bases_not_self_check" CHECK (recipe_id <> base_recipe_id)
);
--> statement-breakpoint
ALTER TABLE "recipe_bases" ADD CONSTRAINT "recipe_bases_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_bases" ADD CONSTRAINT "recipe_bases_base_recipe_id_recipes_id_fk" FOREIGN KEY ("base_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recipe_bases_base" ON "recipe_bases" USING btree ("base_recipe_id");
