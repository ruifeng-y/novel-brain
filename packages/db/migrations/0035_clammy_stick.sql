CREATE TYPE "public"."export_format" AS ENUM('txt', 'markdown', 'docx', 'epub');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"format" "export_format" NOT NULL,
	"scope" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"chapter_count" integer DEFAULT 0 NOT NULL,
	"file_key" text,
	"file_name" text,
	"mime_type" text,
	"file_size" integer,
	"error" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_work_branch_created_idx" ON "export_jobs" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_user_status_idx" ON "export_jobs" USING btree ("user_id","status");
--> statement-breakpoint
ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.export_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY export_jobs_tenant ON public.export_jobs
  FOR ALL
  USING (user_id = app.current_user_id() AND app.owns_work(work_id))
  WITH CHECK (user_id = app.current_user_id() AND app.owns_work(work_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.export_jobs TO novel_app;
