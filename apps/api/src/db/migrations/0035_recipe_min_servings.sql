-- "Esta receta siempre la cocino para al menos N" (specs/recipes.md → Minimum servings).
-- Idempotent: safe to re-run on a database that already has it.
ALTER TABLE "recipe_notes" ADD COLUMN IF NOT EXISTS "min_servings" integer;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_notes_min_servings_check') THEN
    ALTER TABLE "recipe_notes" ADD CONSTRAINT "recipe_notes_min_servings_check"
      CHECK (min_servings IS NULL OR (min_servings >= 1 AND min_servings <= 24));
  END IF;
END $$;
