DROP INDEX "jobs_workflow_idempotency_unique";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "golden_three_generation_key" text;--> statement-breakpoint
UPDATE "jobs"
SET "golden_three_generation_key" = "idempotency_key"
WHERE "type" = 'agent_workflow'
  AND "orchestration"->>'kind' = 'golden_three_generation'
  AND "golden_three_generation_key" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_golden_three_generation_key_unique" ON "jobs" USING btree ("user_id","work_id","branch_id","golden_three_generation_key") WHERE "jobs"."golden_three_generation_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_workflow_idempotency_unique" ON "jobs" USING btree ("user_id","work_id","branch_id","idempotency_key") WHERE "jobs"."type" = 'agent_workflow' and ("jobs"."orchestration"->>'kind' is null or "jobs"."orchestration"->>'kind' <> 'golden_three_generation');
