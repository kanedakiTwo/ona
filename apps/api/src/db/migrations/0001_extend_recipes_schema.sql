CREATE TABLE "recipe_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"text" text NOT NULL,
	"duration_min" integer,
	"temperature" integer,
	"technique" text,
	"ingredient_refs" uuid[] DEFAULT ARRAY[]::uuid[]
);
--> statement-breakpoint
DROP INDEX "uq_recipe_ingredient";--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ALTER COLUMN "unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "fdc_id" integer;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "aisle" text;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "density" real;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "unit_weight" real;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "allergen_tags" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "salt" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "optional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "servings" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "yield_text" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "cook_time" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "active_time" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "total_time" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "difficulty" text DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "equipment" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "allergens" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "tips" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "substitutions" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "storage" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "nutrition_per_serving" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "internal_tags" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recipe_steps_recipe" ON "recipe_steps" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recipe_step_order" ON "recipe_steps" USING btree ("recipe_id","index");--> statement-breakpoint
ALTER TABLE "recipes" DROP COLUMN "steps";--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_unit_check" CHECK (unit IN ('g', 'ml', 'u', 'cda', 'cdita', 'pizca', 'al_gusto'));