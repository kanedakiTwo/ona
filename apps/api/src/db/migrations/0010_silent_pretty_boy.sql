CREATE TABLE "user_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_memory_user_key" ON "user_memories" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "idx_user_memory_user" ON "user_memories" USING btree ("user_id");