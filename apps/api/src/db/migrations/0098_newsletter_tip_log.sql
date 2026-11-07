CREATE TABLE "newsletter_tip_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"tip" text,
	"recipe_id" uuid,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clicked_at" timestamp with time zone,
	"adopted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "newsletter_tip_log" ADD CONSTRAINT "newsletter_tip_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_tip_log" ADD CONSTRAINT "newsletter_tip_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_tip_log" ADD CONSTRAINT "newsletter_tip_log_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_newsletter_tip_log_issue_user" ON "newsletter_tip_log" USING btree ("issue_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_newsletter_tip_log_user" ON "newsletter_tip_log" USING btree ("user_id");