CREATE TYPE "public"."branch_commit_kind" AS ENUM('chapter_version', 'edit', 'change', 'undo', 'rollback', 'merge');--> statement-breakpoint
ALTER TYPE "public"."change_request_status" ADD VALUE 'undone' BEFORE 'rejected';--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch_commits" ALTER COLUMN "chapter_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD COLUMN "parent_commit_id" uuid;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD COLUMN "change_request_id" uuid;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD COLUMN "kind" "branch_commit_kind" DEFAULT 'chapter_version' NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD COLUMN "reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "state_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_work_branch_created_idx" ON "audit_logs" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("work_id","action","created_at");--> statement-breakpoint
ALTER TABLE "work_branches" ADD CONSTRAINT "work_branches_state_branch_id_work_branches_id_fk" FOREIGN KEY ("state_branch_id") REFERENCES "public"."work_branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_commits_parent_idx" ON "branch_commits" USING btree ("parent_commit_id");--> statement-breakpoint
UPDATE "branch_commits" SET "title" = "message" WHERE "title" = '';--> statement-breakpoint

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_logs_tenant ON public.audit_logs
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO novel_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.reject_immutable_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('novel.allow_history_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'immutable history cannot be changed or deleted';
END
$$;--> statement-breakpoint

CREATE TRIGGER branch_commits_immutable
  BEFORE UPDATE OR DELETE ON public.branch_commits
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_history();--> statement-breakpoint
CREATE TRIGGER chapter_versions_immutable
  BEFORE UPDATE OR DELETE ON public.chapter_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_history();--> statement-breakpoint
CREATE TRIGGER canon_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.canon_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_history();--> statement-breakpoint
CREATE TRIGGER story_bible_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.story_bible_revisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_history();--> statement-breakpoint
CREATE TRIGGER character_state_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.character_state_revisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_history();--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_history();
