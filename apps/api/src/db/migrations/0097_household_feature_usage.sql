CREATE TABLE "household_feature_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"feature" text NOT NULL,
	"first_used_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"uses_30d" integer DEFAULT 0 NOT NULL,
	"uses_total" integer DEFAULT 0 NOT NULL,
	"counted_until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_feature_usage" ADD CONSTRAINT "household_feature_usage_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_feature_usage" ADD CONSTRAINT "household_feature_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_household_feature_usage" ON "household_feature_usage" USING btree ("household_id",COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid),"feature");--> statement-breakpoint
CREATE INDEX "idx_household_feature_usage_feature" ON "household_feature_usage" USING btree ("feature");--> statement-breakpoint
CREATE INDEX "idx_household_feature_usage_user" ON "household_feature_usage" USING btree ("user_id");