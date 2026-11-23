CREATE TABLE "mimo_turnos_remotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"peticion" jsonb NOT NULL,
	"respuesta" jsonb,
	CONSTRAINT "mimo_turnos_remotos_estado_check" CHECK (estado IN ('pendiente','cogido','respondido','caducado'))
);
--> statement-breakpoint
CREATE INDEX "idx_mimo_turnos_remotos_estado" ON "mimo_turnos_remotos" USING btree ("estado","creado");