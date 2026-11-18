ALTER TABLE "eval_release_decisions" DROP CONSTRAINT "eval_release_decisions_previous_user_fk";
--> statement-breakpoint
ALTER TABLE "eval_release_decisions" DROP CONSTRAINT "eval_release_decisions_target_user_fk";
--> statement-breakpoint
ALTER TABLE "eval_release_decisions" ADD CONSTRAINT "eval_release_decisions_previous_user_fk" FOREIGN KEY ("previous_decision_id","user_id") REFERENCES "public"."eval_release_decisions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_release_decisions" ADD CONSTRAINT "eval_release_decisions_target_user_fk" FOREIGN KEY ("rollback_target_decision_id","user_id") REFERENCES "public"."eval_release_decisions"("id","user_id") ON DELETE cascade ON UPDATE no action;