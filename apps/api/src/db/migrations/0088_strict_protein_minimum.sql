-- Miguel 2026-10-21: keep the catalogue audit's 80 g protein minimum for starters and rice/legume dishes in this user's menus (default off).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "strict_protein_minimum" boolean DEFAULT false NOT NULL;
