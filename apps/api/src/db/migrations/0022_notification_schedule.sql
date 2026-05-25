CREATE TABLE "notification_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dedup_key" text NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_schedule_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
ALTER TABLE "notification_schedule" ADD CONSTRAINT "notification_schedule_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notif_sched_due" ON "notification_schedule" USING btree ("fire_at","status");--> statement-breakpoint
CREATE INDEX "idx_notif_sched_user" ON "notification_schedule" USING btree ("user_id");