CREATE TABLE "whatsapp_question_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_questions_text_unique" UNIQUE("text")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_question_sends" ADD CONSTRAINT "whatsapp_question_sends_question_id_whatsapp_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."whatsapp_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_question_sends" ADD CONSTRAINT "whatsapp_question_sends_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_question_sends" ADD CONSTRAINT "whatsapp_question_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_questions" ADD CONSTRAINT "whatsapp_questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_question_send" ON "whatsapp_question_sends" USING btree ("question_id","household_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_question_sends_user" ON "whatsapp_question_sends" USING btree ("user_id");