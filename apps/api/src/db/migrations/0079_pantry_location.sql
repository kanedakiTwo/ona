ALTER TABLE "pantry_items" ADD COLUMN "location" text DEFAULT 'despensa' NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD COLUMN "stored_at" timestamp with time zone;