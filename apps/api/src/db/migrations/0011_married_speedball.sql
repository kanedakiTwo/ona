CREATE TABLE "household_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"email" text,
	"token" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_invites_role_check" CHECK (role IN ('member','child'))
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_role_check" CHECK (role IN ('owner','member','child'))
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'Mi casa' NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "primary_household_id" uuid;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_household_invite_token" ON "household_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_household_invites_household" ON "household_invites" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_household_member" ON "household_members" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_household_members_user" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_households_owner" ON "households" USING btree ("owner_id");--> statement-breakpoint

-- Backfill: every existing user gets a solo household + owner membership +
-- primary_household_id set to that new household. Idempotent: re-running on a
-- DB where rows already exist is a no-op thanks to the NOT EXISTS guards.
INSERT INTO "households" ("id", "name", "owner_id", "created_at")
SELECT gen_random_uuid(), 'Mi casa', u.id, NOW()
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "household_members" hm WHERE hm.user_id = u.id
);
--> statement-breakpoint

INSERT INTO "household_members" ("id", "household_id", "user_id", "role", "joined_at")
SELECT gen_random_uuid(), h.id, h.owner_id, 'owner', NOW()
FROM "households" h
WHERE NOT EXISTS (
  SELECT 1 FROM "household_members" hm WHERE hm.household_id = h.id AND hm.user_id = h.owner_id
);
--> statement-breakpoint

UPDATE "users" u
SET "primary_household_id" = (
  SELECT hm.household_id
  FROM "household_members" hm
  JOIN "households" h ON h.id = hm.household_id
  WHERE hm.user_id = u.id AND h.owner_id = u.id
  ORDER BY hm.joined_at ASC
  LIMIT 1
)
WHERE u.primary_household_id IS NULL;