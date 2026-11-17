ALTER TABLE "recipes" ADD COLUMN "featured_on" date;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recipes_featured_on" ON "recipes" USING btree ("featured_on");
