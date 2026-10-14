CREATE TABLE "newsletter_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "newsletter_sends_status_check" CHECK (status IN ('pending','sent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_newsletter_sends_issue_recipient" ON "newsletter_sends" USING btree ("issue_id","recipient_hash");