-- PRO-230: who cooks a given day (only when asked to Mimo); that day's prep alerts go to them.
CREATE TABLE "cook_of_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"day" date NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cook_of_day" ADD CONSTRAINT "cook_of_day_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_of_day" ADD CONSTRAINT "cook_of_day_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_of_day" ADD CONSTRAINT "cook_of_day_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cook_of_day" ON "cook_of_day" USING btree ("household_id","day");