-- Miguel 2026-10-21: «proteína en cada plato» lives in the household ficha (fact `protein_minimum`), not on the account. 0088 never reached production.
ALTER TABLE "users" DROP COLUMN IF EXISTS "strict_protein_minimum";
