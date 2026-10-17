-- PRO-135: the «te quedan 2 días de prueba» email is sent once per household.
ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "trial_ending_email_at" timestamp with time zone;
