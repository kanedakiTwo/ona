-- Per-recipe course classification: 'starter' | 'main' | 'dessert' | null.
-- Idempotent so a partial apply can be re-run safely. Validation enforced at
-- the application layer via the Zod schema in @ona/shared (closed enum).
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "course" text;