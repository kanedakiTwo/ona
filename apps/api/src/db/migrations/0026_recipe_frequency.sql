-- Per-recipe scheduling hint consumed by the menu matcher's pool-weighting
-- and (for `weekends_only`) day-of-week filter. Nullable; null = "normal".
ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "frequency" text;

-- Constrain to the four canonical values so a stray write can't poison
-- the matcher with a value it doesn't understand. Allowing NULL keeps the
-- "no preference" baseline cheap.
ALTER TABLE "recipes"
  DROP CONSTRAINT IF EXISTS "recipes_frequency_check";
ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_frequency_check"
  CHECK ("frequency" IS NULL OR "frequency" IN ('frequent', 'normal', 'occasional', 'weekends_only'));
