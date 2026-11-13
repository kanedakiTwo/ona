CREATE TABLE "payment_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"household_id" uuid,
	"notice_channel" text,
	"notice_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_feedback" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "past_due_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_failures" ADD CONSTRAINT "payment_failures_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_failures_invoice" ON "payment_failures" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "idx_payment_failures_created" ON "payment_failures" USING btree ("created_at");