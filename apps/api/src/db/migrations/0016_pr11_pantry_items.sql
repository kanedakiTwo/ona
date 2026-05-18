CREATE TABLE "pantry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"name" text NOT NULL,
	"quantity" real DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'u' NOT NULL,
	"expires_at" date,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pantry_items_household" ON "pantry_items" USING btree ("household_id");--> statement-breakpoint

-- Partial unique index — one row per (household, ingredient) when the catalog
-- reference is set. Manual free-text items (NULL ingredient_id) can repeat
-- by name without conflicting (the dedup happens at the application layer
-- via a case-insensitive name lookup before insert).
CREATE UNIQUE INDEX "uq_pantry_items_household_ingredient"
  ON "pantry_items" ("household_id", "ingredient_id")
  WHERE "ingredient_id" IS NOT NULL;