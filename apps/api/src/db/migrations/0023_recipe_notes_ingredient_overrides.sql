ALTER TABLE "recipe_notes"
  ADD COLUMN IF NOT EXISTS "ingredient_overrides" jsonb NOT NULL DEFAULT '[]'::jsonb;
