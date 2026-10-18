CREATE TABLE "school_lunches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"dish" text NOT NULL,
	"food_group" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_lunches_group_check" CHECK (food_group IS NULL OR food_group IN ('legumbre','pescado','carne','huevo','pasta_arroz','verdura'))
);
--> statement-breakpoint
ALTER TABLE "school_lunches" ADD CONSTRAINT "school_lunches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_lunches" ADD CONSTRAINT "school_lunches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_school_lunches_household_date" ON "school_lunches" USING btree ("household_id","date");