-- "Compra en mis tiendas" (specs/shop-orders.md): the household's own shops
-- and the per-shop orders ONA drafts from the shopping list. New tables only;
-- idempotent so a partial apply (or a renumbering) can be re-run safely.
CREATE TABLE IF NOT EXISTS "household_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"whatsapp" text,
	"email" text,
	"web_url" text,
	"phone" text,
	"customer_name" text,
	"fulfilment" text DEFAULT 'recoger' NOT NULL,
	"address" text,
	"notes" text,
	"price_memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_shops_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shop_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"shop_id" uuid,
	"shop_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"token" text NOT NULL,
	"lines" jsonb NOT NULL,
	"estimate_eur" real,
	"cap_eur" real,
	"message_text" text NOT NULL,
	"shop_reply_text" text,
	"quote_summary" jsonb,
	"confirmation_text" text,
	"final_total_eur" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"quoted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "shop_orders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "shop_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "shop_orders_shop_id_household_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."household_shops"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_household_shops_household" ON "household_shops" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_shop_orders_token" ON "shop_orders" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shop_orders_household_status" ON "shop_orders" USING btree ("household_id","status");
