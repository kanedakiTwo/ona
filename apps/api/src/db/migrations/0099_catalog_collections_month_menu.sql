-- PRO-378: «Menú del mes». The catalogue collections table of PRO-374 (0098),
-- with `kind = 'menu_mes'`, the month (YYYY-MM) and the week (7 days, per meal
-- the recipe ids). Only adds: the table if 0098 hasn't made it, and every
-- column either task reads if it isn't there yet.
CREATE TABLE IF NOT EXISTS "catalog_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "subtitle" text;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "season" text;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "recipe_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "published" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'coleccion' NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "month" text;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "week" jsonb;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_collections_slug_unique" ON "catalog_collections" ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_catalog_collections_month_menu" ON "catalog_collections" ("month") WHERE "kind" = 'menu_mes';
