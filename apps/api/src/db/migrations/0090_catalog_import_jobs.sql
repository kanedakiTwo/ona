-- Admin «Recetas pendientes» (specs/catalog-import.md): progress of each Cocina batch import launched from the web, run in the background by the API.
CREATE TABLE "catalog_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch" text NOT NULL,
	"origin" text NOT NULL,
	"file_name" text,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "catalog_import_jobs_status_check" CHECK (status IN ('running','done','failed','interrupted'))
);
--> statement-breakpoint
ALTER TABLE "catalog_import_jobs" ADD CONSTRAINT "catalog_import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_catalog_import_jobs_created" ON "catalog_import_jobs" USING btree ("created_at");