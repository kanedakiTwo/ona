ALTER TABLE "waitlist_entries" ADD COLUMN "invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_token_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_waitlist_entries_invite_token_hash" ON "waitlist_entries" USING btree ("invite_token_hash");