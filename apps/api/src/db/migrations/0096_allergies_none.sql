-- PRO-347: «No tengo ninguna» without the health-data consent. Only adds a column.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allergies_none_at" timestamp with time zone;
