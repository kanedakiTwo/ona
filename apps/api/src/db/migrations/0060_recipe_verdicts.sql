CREATE TABLE "recipe_verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"reason" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_verdicts_verdict_check" CHECK (verdict IN ('love','like','nope','skip'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "taste_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_verdicts" ADD CONSTRAINT "recipe_verdicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_verdicts" ADD CONSTRAINT "recipe_verdicts_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recipe_verdicts_user_recipe" ON "recipe_verdicts" USING btree ("user_id","recipe_id");