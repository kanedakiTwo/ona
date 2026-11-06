CREATE TABLE "newsletter_wine_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"wine_id" text NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_wine_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"signature_name" text,
	"signature_about" text,
	"signature_accepted" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"video_wine_id" text,
	"legal_approved" boolean DEFAULT false NOT NULL,
	"legal_ref" text,
	"moderation_line" text,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_wine_settings_single" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "newsletter_wines" (
	"id" text PRIMARY KEY NOT NULL,
	"num" integer,
	"name" text NOT NULL,
	"winery" text NOT NULL,
	"type" text NOT NULL,
	"grape" text,
	"zone" text,
	"vintage" text,
	"price" text,
	"where_to_buy" text,
	"link" text,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"no_go" text[] DEFAULT '{}' NOT NULL,
	"phrase" text NOT NULL,
	"relation" text,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_wine_log" ADD CONSTRAINT "newsletter_wine_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_wine_log" ADD CONSTRAINT "newsletter_wine_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_newsletter_wine_log_issue_user" ON "newsletter_wine_log" USING btree ("issue_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_newsletter_wine_log_user" ON "newsletter_wine_log" USING btree ("user_id");