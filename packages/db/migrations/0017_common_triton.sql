CREATE TABLE "fact_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"fact_proposal_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"reason" text NOT NULL,
	"original_payload" jsonb NOT NULL,
	"resulting_payload" jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fact_decisions_action_check" CHECK ("fact_decisions"."action" in ('confirm', 'modify_confirm', 'reject', 'supersede'))
);
--> statement-breakpoint
CREATE TABLE "fact_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"extraction_key" text NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"object" text NOT NULL,
	"source_sentence" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"confidence" real NOT NULL,
	"risk" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fact_proposals_status_check" CHECK ("fact_proposals"."status" in ('proposed', 'confirmed', 'modified_confirmed', 'rejected', 'superseded')),
	CONSTRAINT "fact_proposals_risk_check" CHECK ("fact_proposals"."risk" in ('low', 'medium', 'high')),
	CONSTRAINT "fact_proposals_confidence_check" CHECK ("fact_proposals"."confidence" >= 0 and "fact_proposals"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "fact_decisions" ADD CONSTRAINT "fact_decisions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decisions" ADD CONSTRAINT "fact_decisions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decisions" ADD CONSTRAINT "fact_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decisions" ADD CONSTRAINT "fact_decisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decisions" ADD CONSTRAINT "fact_decisions_fact_proposal_id_fact_proposals_id_fk" FOREIGN KEY ("fact_proposal_id") REFERENCES "public"."fact_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decisions" ADD CONSTRAINT "fact_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_source_version_id_chapter_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_decisions_proposal_decided_idx" ON "fact_decisions" USING btree ("fact_proposal_id","decided_at");--> statement-breakpoint
CREATE INDEX "fact_decisions_user_work_idx" ON "fact_decisions" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_proposals_source_extraction_unique" ON "fact_proposals" USING btree ("chapter_id","source_version_id","extraction_key");--> statement-breakpoint
CREATE INDEX "fact_proposals_user_work_status_idx" ON "fact_proposals" USING btree ("user_id","work_id","status");--> statement-breakpoint
CREATE INDEX "fact_proposals_chapter_created_idx" ON "fact_proposals" USING btree ("chapter_id","created_at");--> statement-breakpoint
ALTER TABLE "fact_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fact_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fact_proposals_tenant_policy" ON "fact_proposals"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "fact_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fact_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fact_decisions_tenant_policy" ON "fact_decisions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
