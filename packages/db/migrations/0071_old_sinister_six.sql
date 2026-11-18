ALTER TABLE "eval_gates" DROP CONSTRAINT "eval_gates_baseline_run_id_eval_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_gates" DROP CONSTRAINT "eval_gates_candidate_run_id_eval_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_scores" DROP CONSTRAINT "eval_scores_run_id_eval_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "continuity_findings" jsonb;--> statement-breakpoint
UPDATE "eval_runs" SET "continuity_findings" = '[]'::jsonb WHERE "continuity_findings" IS NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ALTER COLUMN "continuity_findings" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_id_user_unique" ON "eval_runs" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "eval_gates" ADD CONSTRAINT "eval_gates_baseline_run_user_fk" FOREIGN KEY ("baseline_run_id","user_id") REFERENCES "public"."eval_runs"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_gates" ADD CONSTRAINT "eval_gates_candidate_run_user_fk" FOREIGN KEY ("candidate_run_id","user_id") REFERENCES "public"."eval_runs"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_run_user_fk" FOREIGN KEY ("run_id","user_id") REFERENCES "public"."eval_runs"("id","user_id") ON DELETE cascade ON UPDATE no action;
