ALTER TABLE "jobs" ADD COLUMN "golden_three_lease_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "jobs"
SET "golden_three_lease_version" = 1
WHERE "type" = 'agent_workflow'
  AND "orchestration"->>'kind' = 'golden_three_generation';
