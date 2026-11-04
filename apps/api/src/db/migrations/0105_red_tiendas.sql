CREATE TABLE "red_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"discount_pct" real DEFAULT 5 NOT NULL,
	"commission_pct" real DEFAULT 5 NOT NULL,
	"commission_vat_included" boolean DEFAULT true NOT NULL,
	"margin_known_pct" real DEFAULT 15 NOT NULL,
	"margin_reference_pct" real DEFAULT 30 NOT NULL,
	"margin_wild_fish_extra_pct" real DEFAULT 10 NOT NULL,
	"terms_version" text DEFAULT 'v2-prueba' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "red_settings_single_row" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "red_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"postal_code" text NOT NULL,
	"address" text,
	"whatsapp" text NOT NULL,
	"delivery_postal_codes" text[] DEFAULT '{}' NOT NULL,
	"delivery_min_eur" real,
	"delivery_fee_eur" real,
	"price_memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"status" text DEFAULT 'activa' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "red_shops_kind_check" CHECK (kind IN ('fruteria','carniceria','pescaderia')),
	CONSTRAINT "red_shops_status_check" CHECK (status IN ('activa','pausada','baja'))
);
--> statement-breakpoint
ALTER TABLE "household_shops" ADD COLUMN "red_shop_id" uuid;--> statement-breakpoint
ALTER TABLE "household_shops" ADD COLUMN "origin" text DEFAULT 'propia' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "red_choices" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "red_shop_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "red_terms" jsonb;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "max_eur" real;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "ordered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "ordered_by_user_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_red_shops_kind_status" ON "red_shops" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_red_shops_whatsapp" ON "red_shops" USING btree ("whatsapp");--> statement-breakpoint
ALTER TABLE "household_shops" ADD CONSTRAINT "household_shops_red_shop_id_red_shops_id_fk" FOREIGN KEY ("red_shop_id") REFERENCES "public"."red_shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_red_shop_id_red_shops_id_fk" FOREIGN KEY ("red_shop_id") REFERENCES "public"."red_shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_ordered_by_user_id_users_id_fk" FOREIGN KEY ("ordered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_household_shops_red" ON "household_shops" USING btree ("red_shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_household_shops_red_copy" ON "household_shops" USING btree ("household_id","kind") WHERE origin = 'red';--> statement-breakpoint
CREATE INDEX "idx_shop_orders_red_shop" ON "shop_orders" USING btree ("red_shop_id");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_ordered_by" ON "shop_orders" USING btree ("ordered_by_user_id");--> statement-breakpoint
ALTER TABLE "household_shops" ADD CONSTRAINT "household_shops_origin_check" CHECK (origin IN ('propia','red'));--> statement-breakpoint
INSERT INTO "red_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
