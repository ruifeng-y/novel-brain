ALTER TABLE "golden_three_candidates" ADD COLUMN "generation_job_id" uuid;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD COLUMN "model_call_id" uuid;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_generation_job_id_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_model_call_id_model_calls_id_fk" FOREIGN KEY ("model_call_id") REFERENCES "public"."model_calls"("id") ON DELETE set null ON UPDATE no action;