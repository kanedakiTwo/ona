ALTER TABLE "menus" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_menus_household_week" ON "menus" USING btree ("household_id","week_start");--> statement-breakpoint
CREATE INDEX "idx_shopping_lists_household" ON "shopping_lists" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_user_favorites_household" ON "user_favorites" USING btree ("household_id");--> statement-breakpoint

-- Backfill: every existing row inherits the owner's primary household.
-- Migration 0011 guarantees every user has a `primary_household_id`, so
-- these UPDATEs cannot leave rows with NULL unless the user was deleted
-- between 0011 and 0012 (impossible — both run in the same boot).
-- Idempotent: re-running is a no-op once the columns are full.
UPDATE "menus" m
SET "household_id" = u."primary_household_id"
FROM "users" u
WHERE m."user_id" = u."id" AND m."household_id" IS NULL;
--> statement-breakpoint

UPDATE "shopping_lists" s
SET "household_id" = u."primary_household_id"
FROM "users" u
WHERE s."user_id" = u."id" AND s."household_id" IS NULL;
--> statement-breakpoint

UPDATE "user_favorites" f
SET "household_id" = u."primary_household_id"
FROM "users" u
WHERE f."user_id" = u."id" AND f."household_id" IS NULL;