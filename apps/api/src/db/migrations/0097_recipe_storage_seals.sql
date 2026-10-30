-- PRO-372: «Se puede congelar» and «Aguanta N días en nevera» seals. Only adds columns.
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "freezable" boolean;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "fridge_days" smallint;
