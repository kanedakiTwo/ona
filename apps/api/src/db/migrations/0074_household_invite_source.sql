ALTER TABLE "household_invites" ADD COLUMN "source" text DEFAULT 'casa' NOT NULL;--> statement-breakpoint
ALTER TABLE "household_invites" ADD COLUMN "shared_at" timestamp with time zone;