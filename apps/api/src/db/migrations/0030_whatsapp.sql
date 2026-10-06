-- WhatsApp channel (specs/whatsapp.md): phone↔user links, one-time link codes,
-- WhatsApp-first link tokens, and the inbound/outbound message log (dedupe +
-- server-side chat history).
-- New tables only; idempotent so a partial apply can be re-run safely.
CREATE TABLE IF NOT EXISTS "whatsapp_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"profile_name" text,
	"notify" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_inbound_at" timestamp with time zone,
	CONSTRAINT "whatsapp_links_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "whatsapp_links_phone_unique" UNIQUE("phone"),
	CONSTRAINT "whatsapp_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wa_link_codes_user" ON "whatsapp_link_codes" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wamid" text,
	"phone" text NOT NULL,
	"user_id" uuid,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_wamid_unique" UNIQUE("wamid"),
	CONSTRAINT "whatsapp_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wa_messages_phone_created" ON "whatsapp_messages" USING btree ("phone","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_phone_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"profile_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wa_phone_tokens_phone" ON "whatsapp_phone_tokens" USING btree ("phone");
