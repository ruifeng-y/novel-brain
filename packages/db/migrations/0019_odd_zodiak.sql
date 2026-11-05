CREATE TABLE "canon_commits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_version_id" uuid NOT NULL,
	"version_node_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"decision_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"fact_proposal_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"canon_commit_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"object" text NOT NULL,
	"risk" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_risk_check" CHECK ("facts"."risk" in ('low', 'medium', 'high')),
	CONSTRAINT "facts_status_check" CHECK ("facts"."status" in ('active', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_fact_proposal_id_fact_proposals_id_fk" FOREIGN KEY ("fact_proposal_id") REFERENCES "public"."fact_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_decision_id_fact_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."fact_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_version_id_chapter_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_canon_commit_id_canon_commits_id_fk" FOREIGN KEY ("canon_commit_id") REFERENCES "public"."canon_commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canon_commits_chapter_unique" ON "canon_commits" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canon_commits_version_node_unique" ON "canon_commits" USING btree ("version_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canon_commits_user_chapter_idempotency_unique" ON "canon_commits" USING btree ("user_id","chapter_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "canon_commits_user_work_idx" ON "canon_commits" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "canon_commits_branch_created_idx" ON "canon_commits" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_fact_proposal_unique" ON "facts" USING btree ("fact_proposal_id");--> statement-breakpoint
CREATE INDEX "facts_user_work_status_idx" ON "facts" USING btree ("user_id","work_id","status");--> statement-breakpoint
CREATE INDEX "facts_chapter_created_idx" ON "facts" USING btree ("chapter_id","created_at");--> statement-breakpoint
ALTER TABLE "canon_commits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canon_commits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "canon_commits_tenant_policy" ON "canon_commits"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "facts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "facts_tenant_policy" ON "facts"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
