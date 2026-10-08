-- PRO-23: «Tengo 14 años o más» at sign-up (LOPDGDD art. 7). Additive.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age_confirmed_at" timestamp with time zone;
