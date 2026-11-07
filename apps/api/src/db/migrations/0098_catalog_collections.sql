-- PRO-374: catalogue collections («Vuelta al cole», «Otoño»), uploaded by Cocina from Admin. Only adds a table.
CREATE TABLE IF NOT EXISTS "catalog_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"season" text,
	"recipe_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_collections_slug_unique" UNIQUE("slug")
);
