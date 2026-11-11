ALTER TABLE "job_steps" DROP CONSTRAINT "job_steps_step_check";--> statement-breakpoint
ALTER TABLE "job_steps" DROP CONSTRAINT "job_steps_status_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "chapter_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "model_config_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "orchestration" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_workflow_idempotency_unique" ON "jobs" USING btree ("user_id","work_id","branch_id","idempotency_key") WHERE "jobs"."type" = 'agent_workflow';--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_step_check" CHECK ("job_steps"."step_key" ~ '^[a-z][a-z0-9_.-]{0,99}$');--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_status_check" CHECK ("job_steps"."status" in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_required_scope_check" CHECK (("jobs"."type" = 'agent_workflow') or ("jobs"."chapter_id" is not null and "jobs"."model_config_id" is not null));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_chapter', 'agent_workflow'));