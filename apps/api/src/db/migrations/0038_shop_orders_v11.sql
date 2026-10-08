-- Compra en mis tiendas v1.1 (specs/shop-orders.md): delivery minimum/fee per
-- shop, pickup-or-delivery + address per order, and the household's remembered
-- choices for products that need one (jamón → serrano…). Idempotent.
CREATE TABLE IF NOT EXISTS "household_buy_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"choice" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_buy_prefs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "household_shops" ADD COLUMN IF NOT EXISTS "delivery_min_eur" real;--> statement-breakpoint
ALTER TABLE "household_shops" ADD COLUMN IF NOT EXISTS "delivery_fee_eur" real;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "fulfilment" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_household_buy_prefs" ON "household_buy_prefs" USING btree ("household_id","rule_key");
