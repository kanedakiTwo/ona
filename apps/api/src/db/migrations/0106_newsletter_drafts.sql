CREATE TABLE "newsletter_drafts" (
	"issue_id" text PRIMARY KEY NOT NULL,
	"recommendation" jsonb,
	"recommended_at" timestamp with time zone,
	"template" jsonb,
	"saved_by" uuid,
	"saved_at" timestamp with time zone,
	"proof_sent_at" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"scheduled_by" uuid,
	"api_url" text,
	"sent_at" timestamp with time zone,
	"send_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_drafts" ADD CONSTRAINT "newsletter_drafts_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_drafts" ADD CONSTRAINT "newsletter_drafts_scheduled_by_users_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_newsletter_drafts_scheduled" ON "newsletter_drafts" USING btree ("scheduled_for");