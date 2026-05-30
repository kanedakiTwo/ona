-- Add three-state fit maps next to the legacy `meals` / `seasons` arrays.
-- Each map is { [meal|season]: 'mid' | 'perfect' }. Absent key = 'none'
-- (the matcher excludes it). Legacy rows have NULL until they're re-saved;
-- read paths fall back to deriving 'perfect' from the array entries.
ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "meal_fit" jsonb;
ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "season_fit" jsonb;
