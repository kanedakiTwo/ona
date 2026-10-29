-- PRO-378: «Menú del mes». The catalogue collections table of PRO-374, with
-- `kind = 'menu_mes'`, the month (YYYY-MM) and the week (7 days, per meal the
-- recipe ids). Only adds: the table if PRO-374 hasn't made it yet, and the
-- columns this task reads if it has.
CREATE TABLE IF NOT EXISTS "catalog_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'coleccion' NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "month" text;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "week" jsonb;
--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_catalog_collections_month_menu" ON "catalog_collections" ("month") WHERE "kind" = 'menu_mes';
