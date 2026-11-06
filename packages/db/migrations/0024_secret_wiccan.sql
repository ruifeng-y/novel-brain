CREATE TABLE "agent_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tool_names" jsonb NOT NULL,
	"resource_scope" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"max_impact" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"issued_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_grants_role_check" CHECK ("agent_grants"."role" in ('planner', 'context_curator', 'writer', 'critic', 'reviser', 'fact_extractor', 'canon_curator')),
	CONSTRAINT "agent_grants_status_check" CHECK ("agent_grants"."status" in ('active', 'revoked')),
	CONSTRAINT "agent_grants_revocation_check" CHECK (("agent_grants"."status" = 'active' and "agent_grants"."revoked_at" is null and "agent_grants"."revoked_by" is null and "agent_grants"."revocation_reason" is null) or ("agent_grants"."status" = 'revoked' and "agent_grants"."revoked_at" is not null and "agent_grants"."revoked_by" is not null and "agent_grants"."revocation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "agent_tool_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"side_effect" text,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"input_hash" text NOT NULL,
	"input_summary" jsonb NOT NULL,
	"output_summary" jsonb,
	"affected_resources" integer NOT NULL,
	"estimated_cost_cny" real NOT NULL,
	"estimated_tokens" integer NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_tool_calls_decision_check" CHECK ("agent_tool_calls"."decision" in ('allow', 'deny')),
	CONSTRAINT "agent_tool_calls_side_effect_check" CHECK ("agent_tool_calls"."side_effect" is null or "agent_tool_calls"."side_effect" in ('S0', 'S1', 'S2', 'S3', 'S4')),
	CONSTRAINT "agent_tool_calls_status_check" CHECK ("agent_tool_calls"."status" in ('authorized', 'denied', 'succeeded', 'failed')),
	CONSTRAINT "agent_tool_calls_affected_check" CHECK ("agent_tool_calls"."affected_resources" > 0),
	CONSTRAINT "agent_tool_calls_cost_check" CHECK ("agent_tool_calls"."estimated_cost_cny" >= 0),
	CONSTRAINT "agent_tool_calls_tokens_check" CHECK ("agent_tool_calls"."estimated_tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_grant_id_agent_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."agent_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_grants_user_work_idx" ON "agent_grants" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "agent_grants_branch_task_idx" ON "agent_grants" USING btree ("branch_id","task_id");--> statement-breakpoint
CREATE INDEX "agent_grants_expires_idx" ON "agent_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_grant_created_idx" ON "agent_tool_calls" USING btree ("grant_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_user_work_idx" ON "agent_tool_calls" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "agent_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agent_grants_tenant_policy" ON "agent_grants"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agent_tool_calls_tenant_policy" ON "agent_tool_calls"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
