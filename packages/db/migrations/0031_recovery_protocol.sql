CREATE TABLE "job_recoveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"from_status" text NOT NULL,
	"from_checkpoint_version" integer NOT NULL,
	"checkpoint_version" integer NOT NULL,
	"resume_step" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_recoveries_action_check" CHECK ("job_recoveries"."action" in ('retry', 'resume')),
	CONSTRAINT "job_recoveries_reason_check" CHECK (length(trim("job_recoveries"."reason")) > 0),
	CONSTRAINT "job_recoveries_from_status_check" CHECK ("job_recoveries"."from_status" in ('queued', 'preparing', 'running', 'paused', 'waiting_review', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "job_recoveries_versions_check" CHECK ("job_recoveries"."from_checkpoint_version" >= 0 and "job_recoveries"."checkpoint_version" > "job_recoveries"."from_checkpoint_version"),
	CONSTRAINT "job_recoveries_resume_step_check" CHECK ("job_recoveries"."resume_step" ~ '^[a-z][a-z0-9_.-]{0,99}$')
);
--> statement-breakpoint
CREATE TABLE "job_step_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"input_hash" text,
	"output_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkpoint_revision" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_step_attempts_step_check" CHECK ("job_step_attempts"."step_key" ~ '^[a-z][a-z0-9_.-]{0,99}$'),
	CONSTRAINT "job_step_attempts_status_check" CHECK ("job_step_attempts"."status" in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
	CONSTRAINT "job_step_attempts_attempt_check" CHECK ("job_step_attempts"."attempt" > 0),
	CONSTRAINT "job_step_attempts_checkpoint_revision_check" CHECK ("job_step_attempts"."checkpoint_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD COLUMN "output_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "job_steps" ADD COLUMN "output_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "checkpoint_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (PARTITION BY "job_id" ORDER BY "created_at", "id") - 1 AS "revision"
	FROM "job_checkpoints"
)
UPDATE "job_checkpoints" AS "checkpoint"
SET "revision" = "ranked"."revision",
	"schema_version" = 1
FROM "ranked"
WHERE "checkpoint"."id" = "ranked"."id";--> statement-breakpoint
UPDATE "jobs"
SET "checkpoint_version" = COALESCE(
	(SELECT max("revision") FROM "job_checkpoints" WHERE "job_id" = "jobs"."id"),
	0
);--> statement-breakpoint
UPDATE "jobs"
SET "checkpoint" = jsonb_set(
	jsonb_set("checkpoint", '{schemaVersion}', '1'::jsonb, true),
	'{revision}',
	to_jsonb("checkpoint_version"),
	true
)
WHERE NOT ("checkpoint" ? 'schemaVersion');--> statement-breakpoint
INSERT INTO "job_step_attempts" (
	"id", "job_id", "work_id", "branch_id", "user_id", "step_key", "attempt",
	"status", "input_hash", "output_refs", "checkpoint_revision",
	"error_code", "error_message", "started_at", "finished_at", "created_at"
)
SELECT
	gen_random_uuid(),
	"step"."job_id",
	"step"."work_id",
	"step"."branch_id",
	"step"."user_id",
	"step"."step_key",
	"step"."attempt",
	"step"."status",
	"step"."input_hash",
	'[]'::jsonb,
	"job"."checkpoint_version",
	"step"."error_code",
	"step"."error_message",
	COALESCE("step"."started_at", "step"."created_at"),
	"step"."finished_at",
	"step"."created_at"
FROM "job_steps" AS "step"
INNER JOIN "jobs" AS "job" ON "job"."id" = "step"."job_id"
WHERE "step"."attempt" > 0;--> statement-breakpoint
ALTER TABLE "job_recoveries" ADD CONSTRAINT "job_recoveries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recoveries" ADD CONSTRAINT "job_recoveries_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recoveries" ADD CONSTRAINT "job_recoveries_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recoveries" ADD CONSTRAINT "job_recoveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recoveries" ADD CONSTRAINT "job_recoveries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_attempts" ADD CONSTRAINT "job_step_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_attempts" ADD CONSTRAINT "job_step_attempts_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_attempts" ADD CONSTRAINT "job_step_attempts_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_attempts" ADD CONSTRAINT "job_step_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_recoveries_job_idempotency_unique" ON "job_recoveries" USING btree ("job_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "job_recoveries_user_work_idx" ON "job_recoveries" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "job_recoveries_job_created_idx" ON "job_recoveries" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_step_attempts_job_step_attempt_unique" ON "job_step_attempts" USING btree ("job_id","step_key","attempt");--> statement-breakpoint
CREATE INDEX "job_step_attempts_job_step_started_idx" ON "job_step_attempts" USING btree ("job_id","step_key","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_checkpoints_job_revision_unique" ON "job_checkpoints" USING btree ("job_id","revision");--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD CONSTRAINT "job_checkpoints_schema_version_check" CHECK ("job_checkpoints"."schema_version" > 0);--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD CONSTRAINT "job_checkpoints_revision_check" CHECK ("job_checkpoints"."revision" >= 0);--> statement-breakpoint
ALTER TABLE "job_checkpoints" ADD CONSTRAINT "job_checkpoints_attempt_check" CHECK ("job_checkpoints"."attempt" >= 0);--> statement-breakpoint
ALTER TABLE "job_step_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_step_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "job_step_attempts_tenant_policy" ON "job_step_attempts"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "job_recoveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_recoveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "job_recoveries_tenant_policy" ON "job_recoveries"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
