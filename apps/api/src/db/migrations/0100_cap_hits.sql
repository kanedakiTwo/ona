CREATE TABLE "cap_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid,
	"month" text NOT NULL,
	"cap" text NOT NULL,
	"spent_micros" bigint NOT NULL,
	"cap_micros" bigint NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cap_hits_cap_check" CHECK (cap IN ('asistente','ia')),
	CONSTRAINT "cap_hits_channel_check" CHECK (channel IN ('app','whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "cap_hits" ADD CONSTRAINT "cap_hits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cap_hits" ADD CONSTRAINT "cap_hits_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cap_hits_user_month" ON "cap_hits" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "idx_cap_hits_month" ON "cap_hits" USING btree ("month");