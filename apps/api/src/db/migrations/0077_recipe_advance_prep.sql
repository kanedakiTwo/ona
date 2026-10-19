-- PRO-220: «preparativos con antelación» of each recipe (text + hours before).
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "advance_prep" jsonb DEFAULT '[]'::jsonb NOT NULL;
