CREATE TABLE "newsletter_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" text NOT NULL,
	"link_index" integer NOT NULL,
	"destination" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_unsubscribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_newsletter_clicks_issue_link" ON "newsletter_clicks" USING btree ("issue_id","link_index");--> statement-breakpoint
CREATE INDEX "idx_newsletter_unsubscribes_issue" ON "newsletter_unsubscribes" USING btree ("issue_id");