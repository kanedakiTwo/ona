CREATE TABLE "catalog_wish_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wish_id" uuid NOT NULL,
	"voter_key" text NOT NULL,
	"household_id" uuid,
	"user_id" uuid,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_wish_votes_source_check" CHECK (source IN ('alta','me_encanta','mimo','evaluador'))
);
--> statement-breakpoint
CREATE TABLE "catalog_wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dish" text NOT NULL,
	"dish_key" text NOT NULL,
	"status" text DEFAULT 'abierto' NOT NULL,
	"recipe_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_wishes_status_check" CHECK (status IN ('abierto','cubierto','descartado'))
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "catalog_source" jsonb;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "import_batch" text;--> statement-breakpoint
ALTER TABLE "catalog_wish_votes" ADD CONSTRAINT "catalog_wish_votes_wish_id_catalog_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."catalog_wishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_wish_votes" ADD CONSTRAINT "catalog_wish_votes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_wish_votes" ADD CONSTRAINT "catalog_wish_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_wishes" ADD CONSTRAINT "catalog_wishes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_catalog_wish_votes_voter" ON "catalog_wish_votes" USING btree ("wish_id","voter_key","source");--> statement-breakpoint
CREATE INDEX "idx_catalog_wish_votes_wish" ON "catalog_wish_votes" USING btree ("wish_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_catalog_wishes_key" ON "catalog_wishes" USING btree ("dish_key");--> statement-breakpoint
CREATE INDEX "idx_recipes_import_batch" ON "recipes" USING btree ("import_batch");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_status_check" CHECK (status IN ('draft','published'));