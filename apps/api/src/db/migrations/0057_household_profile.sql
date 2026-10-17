CREATE TABLE "household_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"age_band" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_persons_age_band_check" CHECK (age_band IN ('0-2','3-5','6-12','13-17','adulto'))
);
--> statement-breakpoint
CREATE TABLE "household_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"portrait" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"fact_id" uuid,
	"action" text NOT NULL,
	"fact_type" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"origin" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_changes_origin_check" CHECK (origin IN ('user','onboarding','ai_realtime','ai_nightly','ai_weekly'))
);
--> statement-breakpoint
CREATE TABLE "profile_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"subject_person_id" uuid,
	"type" text NOT NULL,
	"value" jsonb NOT NULL,
	"origin" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"source_memory_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_facts_origin_check" CHECK (origin IN ('user','onboarding','ai_realtime','ai_nightly','ai_weekly')),
	CONSTRAINT "profile_facts_status_check" CHECK (status IN ('active','retired')),
	CONSTRAINT "profile_facts_confidence_check" CHECK (confidence >= 0 AND confidence <= 1),
	CONSTRAINT "profile_facts_one_subject_check" CHECK (subject_user_id IS NULL OR subject_person_id IS NULL)
);
--> statement-breakpoint
CREATE TABLE "profile_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"subject_person_id" uuid,
	"question" text NOT NULL,
	"fact_type" text,
	"origin" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"asked_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_questions_status_check" CHECK (status IN ('pending','asked','answered','dismissed')),
	CONSTRAINT "profile_questions_origin_check" CHECK (origin IN ('user','onboarding','ai_realtime','ai_nightly','ai_weekly'))
);
--> statement-breakpoint
ALTER TABLE "household_persons" ADD CONSTRAINT "household_persons_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_profiles" ADD CONSTRAINT "household_profiles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_fact_id_profile_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."profile_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_subject_person_id_household_persons_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."household_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_questions" ADD CONSTRAINT "profile_questions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_questions" ADD CONSTRAINT "profile_questions_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_questions" ADD CONSTRAINT "profile_questions_subject_person_id_household_persons_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."household_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_household_persons_household" ON "household_persons" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_household_profiles_household" ON "household_profiles" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_profile_changes_household_created" ON "profile_changes" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_profile_facts_household_status" ON "profile_facts" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "idx_profile_facts_subject_user" ON "profile_facts" USING btree ("subject_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_profile_facts_source_memory" ON "profile_facts" USING btree ("source_memory_id");--> statement-breakpoint
CREATE INDEX "idx_profile_questions_household_status" ON "profile_questions" USING btree ("household_id","status");