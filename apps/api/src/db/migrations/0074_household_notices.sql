CREATE TABLE "household_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"household_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"whatsapp_sent_at" timestamp with time zone,
	"app_since" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "household_notices" ADD CONSTRAINT "household_notices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_notices" ADD CONSTRAINT "household_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_household_notices_key_household" ON "household_notices" USING btree ("key","household_id");--> statement-breakpoint
CREATE INDEX "idx_household_notices_household" ON "household_notices" USING btree ("household_id");