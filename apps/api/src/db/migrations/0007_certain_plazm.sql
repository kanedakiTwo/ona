ALTER TABLE "users" ADD COLUMN "image_gen_month_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image_gen_count" integer DEFAULT 0 NOT NULL;