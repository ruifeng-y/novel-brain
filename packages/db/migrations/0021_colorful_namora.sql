ALTER TABLE "entities" DROP CONSTRAINT "entities_type_check";--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "valid_to_chapter" integer;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "step_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_job_step_unique" ON "agent_runs" USING btree ("job_id","step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_job_step_unique" ON "usage_records" USING btree ("job_id","step_key") WHERE "usage_records"."step_key" is not null;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_type_check" CHECK ("entities"."type" in ('world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger'));