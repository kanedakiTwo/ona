-- PRO-27: invitation links by campaign + the campaign each account signed up with. Additive, idempotent.
CREATE TABLE IF NOT EXISTS "invite_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_campaign_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invite_campaigns_code" ON "invite_campaigns" USING btree ("code");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_invite_campaign_id_invite_campaigns_id_fk" FOREIGN KEY ("invite_campaign_id") REFERENCES "public"."invite_campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
