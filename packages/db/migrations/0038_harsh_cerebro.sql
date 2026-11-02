CREATE TYPE "public"."account_export_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "account_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "account_export_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"file_key" text,
	"file_name" text,
	"mime_type" text,
	"file_size" integer,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_export_jobs" ADD CONSTRAINT "account_export_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_export_jobs_user_created_idx" ON "account_export_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE public.account_export_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.account_export_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY account_export_jobs_tenant ON public.account_export_jobs
  FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_export_jobs TO novel_app;
