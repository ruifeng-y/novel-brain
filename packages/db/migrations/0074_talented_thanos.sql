CREATE TABLE "eval_release_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_key" text NOT NULL,
	"release_version" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"decision_sha256" text NOT NULL,
	"policy_sha256" text,
	"cohort_sha256" text,
	"config_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"previous_decision_id" uuid,
	"rollback_target_decision_id" uuid,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_release_decisions_action_check" CHECK ("eval_release_decisions"."action" in ('canary', 'rollback')),
	CONSTRAINT "eval_release_decisions_status_check" CHECK ("eval_release_decisions"."status" in ('approved', 'blocked', 'rolled_back')),
	CONSTRAINT "eval_release_decisions_hashes_check" CHECK ("eval_release_decisions"."decision_sha256" ~ '^[a-f0-9]{64}$' and "eval_release_decisions"."config_hash" ~ '^[a-f0-9]{64}$' and ("eval_release_decisions"."policy_sha256" is null or "eval_release_decisions"."policy_sha256" ~ '^[a-f0-9]{64}$') and ("eval_release_decisions"."cohort_sha256" is null or "eval_release_decisions"."cohort_sha256" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "eval_release_decisions_rollback_refs_check" CHECK (("eval_release_decisions"."action" = 'canary' and "eval_release_decisions"."previous_decision_id" is null and "eval_release_decisions"."rollback_target_decision_id" is null) or ("eval_release_decisions"."action" = 'rollback' and "eval_release_decisions"."previous_decision_id" is not null and "eval_release_decisions"."rollback_target_decision_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "eval_release_decisions" ADD CONSTRAINT "eval_release_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_release_decisions_user_sha_unique" ON "eval_release_decisions" USING btree ("user_id","decision_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_release_decisions_id_user_unique" ON "eval_release_decisions" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "eval_release_decisions" ADD CONSTRAINT "eval_release_decisions_previous_user_fk" FOREIGN KEY ("previous_decision_id","user_id") REFERENCES "public"."eval_release_decisions"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_release_decisions" ADD CONSTRAINT "eval_release_decisions_target_user_fk" FOREIGN KEY ("rollback_target_decision_id","user_id") REFERENCES "public"."eval_release_decisions"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_release_decisions_user_channel_created_idx" ON "eval_release_decisions" USING btree ("user_id","channel_key","created_at");--> statement-breakpoint
ALTER TABLE "eval_release_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_release_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "eval_release_decisions_tenant_policy" ON "eval_release_decisions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION eval_release_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' AND current_setting('app.system_role', true) = 'account_deletion' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'eval_release_decisions is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER eval_release_decisions_append_only_trigger
BEFORE UPDATE OR DELETE ON "eval_release_decisions"
FOR EACH ROW EXECUTE FUNCTION eval_release_decisions_append_only();
