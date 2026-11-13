-- «Semana tipo» (D-182). Only adds: a table and a nullable column.
CREATE TABLE "household_week_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_week_types_household_id_unique" UNIQUE("household_id")
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "dish_types" text[];--> statement-breakpoint
ALTER TABLE "household_week_types" ADD CONSTRAINT "household_week_types_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;