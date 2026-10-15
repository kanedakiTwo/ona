CREATE TABLE "price_survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"too_cheap_eur" real,
	"good_eur" real,
	"expensive_eur" real,
	"too_expensive_eur" real,
	"answered_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_survey_responses" ADD CONSTRAINT "price_survey_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_survey_user" ON "price_survey_responses" USING btree ("user_id");