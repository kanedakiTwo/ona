-- Back-reference from a user-owned copy to the recipe it was copied from.
-- Set by `POST /recipes/:id/copy` and the assistant's `add_recipe_to_mine`
-- skill. Used by the catalogue listing to suppress the system original
-- when the caller already has their own copy (so the user doesn't see
-- "Bacalao con arroz · ONA" and "Bacalao con arroz · Tuya" side-by-side).
ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "copied_from_recipe_id" uuid REFERENCES "recipes"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_recipes_copied_from_recipe_id"
  ON "recipes" ("copied_from_recipe_id")
  WHERE "copied_from_recipe_id" IS NOT NULL;
