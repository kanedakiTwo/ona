ALTER TABLE "recipe_ingredients" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "substitute_ingredient_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_role_check" CHECK (role IS NULL OR role IN ('essential', 'secondary'));