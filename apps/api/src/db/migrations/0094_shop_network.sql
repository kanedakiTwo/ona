CREATE TABLE "network_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"tier" text NOT NULL,
	"coverage" jsonb NOT NULL,
	"channel" text NOT NULL,
	"whatsapp" text,
	"email" text,
	"web_url" text,
	"phone" text,
	"fulfilment" jsonb NOT NULL,
	"delivery_min_eur" real,
	"delivery_fee_eur" real,
	"free_delivery_from_eur" real,
	"notes" text,
	"status" text DEFAULT 'activa' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_shops" ADD COLUMN "network_shop_id" uuid;--> statement-breakpoint
ALTER TABLE "household_shops" ADD COLUMN "origin" text DEFAULT 'propia' NOT NULL;--> statement-breakpoint
ALTER TABLE "household_shops" ADD CONSTRAINT "household_shops_network_shop_id_network_shops_id_fk" FOREIGN KEY ("network_shop_id") REFERENCES "public"."network_shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_household_shops_network" ON "household_shops" USING btree ("network_shop_id");