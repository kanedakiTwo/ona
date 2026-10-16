ALTER TABLE "users" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_attribution" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_referral_code" ON "users" USING btree ("referral_code");