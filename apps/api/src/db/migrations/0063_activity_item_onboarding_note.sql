ALTER TABLE "activity_events" ADD COLUMN "item" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "toggled_on" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_note" text;