CREATE TABLE "menu_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"menu_id" uuid NOT NULL,
	"user_id" uuid,
	"day" integer,
	"meal" text,
	"from_day" integer,
	"from_meal" text,
	"action" text NOT NULL,
	"before_recipe_id" uuid,
	"before_recipe_name" text,
	"after_recipe_id" uuid,
	"after_recipe_name" text,
	"actor" text NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_edits_action_check" CHECK (action IN ('swap','add','remove','ban','skip_day','move','leftover','freezer')),
	CONSTRAINT "menu_edits_actor_check" CHECK (actor IN ('user','mimo')),
	CONSTRAINT "menu_edits_channel_check" CHECK (channel IN ('web','whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "menu_edits" ADD CONSTRAINT "menu_edits_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_edits" ADD CONSTRAINT "menu_edits_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_edits" ADD CONSTRAINT "menu_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_menu_edits_household_created" ON "menu_edits" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_menu_edits_menu" ON "menu_edits" USING btree ("menu_id");