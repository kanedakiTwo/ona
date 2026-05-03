ALTER TABLE "users" ADD COLUMN "adults" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kids_2_to_10" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill the new columns from the legacy `household_size` enum so existing
-- users keep their shopping-list math intact across the rename. The mapping
-- mirrors `householdSizeToCounts()` from `@ona/shared/utils/household`:
--   solo              → 1 adult,   0 kids   (multiplier 1.0)
--   couple            → 2 adults,  0 kids   (multiplier 2.0)
--   family_no_kids    → 3 adults,  0 kids   (multiplier 3.0)
--   family_with_kids  → 2 adults,  2 kids   (multiplier 3.0)
UPDATE "users" SET "adults" = 1, "kids_2_to_10" = 0 WHERE "household_size" = 'solo';--> statement-breakpoint
UPDATE "users" SET "adults" = 2, "kids_2_to_10" = 0 WHERE "household_size" = 'couple';--> statement-breakpoint
UPDATE "users" SET "adults" = 3, "kids_2_to_10" = 0 WHERE "household_size" = 'family_no_kids';--> statement-breakpoint
UPDATE "users" SET "adults" = 2, "kids_2_to_10" = 2 WHERE "household_size" = 'family_with_kids';
