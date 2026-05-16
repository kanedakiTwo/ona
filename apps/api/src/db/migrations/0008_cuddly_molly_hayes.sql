CREATE TABLE "unit_conversion_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_unit" text NOT NULL,
	"ingredient_id" uuid,
	"grams_per_unit" real,
	"ml_per_unit" real,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_conversion_cache_value_check" CHECK ("unit_conversion_cache"."grams_per_unit" IS NOT NULL OR "unit_conversion_cache"."ml_per_unit" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "display_quantity" real;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "display_unit" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "servings_confidence" text DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_conversion_cache" ADD CONSTRAINT "unit_conversion_cache_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_unit_cache_unit" ON "unit_conversion_cache" USING btree ("display_unit");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unit_cache_key" ON "unit_conversion_cache" USING btree ("display_unit",COALESCE("ingredient_id", '00000000-0000-0000-0000-000000000000'::uuid));