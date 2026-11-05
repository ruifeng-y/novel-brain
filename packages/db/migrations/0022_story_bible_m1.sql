CREATE TABLE "story_bible_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"story_bible_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"card_key" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"risk" text DEFAULT 'medium' NOT NULL,
	"source" text DEFAULT 'author' NOT NULL,
	"idempotency_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_bible_change_requests_card_key_check" CHECK ("story_bible_change_requests"."card_key" in ('oneSentence', 'sellingPoints', 'protagonist', 'goldenFinger', 'worldLaws', 'mainPlot', 'subplots', 'ending', 'readerPromise')),
	CONSTRAINT "story_bible_change_requests_status_check" CHECK ("story_bible_change_requests"."status" in ('pending', 'analyzing', 'approved', 'rejected', 'applied')),
	CONSTRAINT "story_bible_change_requests_risk_check" CHECK ("story_bible_change_requests"."risk" in ('low', 'medium', 'high')),
	CONSTRAINT "story_bible_change_requests_source_check" CHECK ("story_bible_change_requests"."source" in ('author', 'ai', 'import', 'batch'))
);
--> statement-breakpoint
CREATE TABLE "story_bible_world_rules" (
	"id" uuid NOT NULL,
	"story_bible_version_id" uuid NOT NULL,
	"story_bible_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"constraint" text NOT NULL,
	"scope" text NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_bible_world_rules_id_story_bible_version_id_pk" PRIMARY KEY("id","story_bible_version_id")
);
--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD COLUMN "action" text DEFAULT 'locked' NOT NULL;--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD COLUMN "reason" text DEFAULT '锁定故事圣经' NOT NULL;--> statement-breakpoint
ALTER TABLE "story_bible_change_requests" ADD CONSTRAINT "story_bible_change_requests_story_bible_id_story_bibles_id_fk" FOREIGN KEY ("story_bible_id") REFERENCES "public"."story_bibles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_change_requests" ADD CONSTRAINT "story_bible_change_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_change_requests" ADD CONSTRAINT "story_bible_change_requests_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_change_requests" ADD CONSTRAINT "story_bible_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_change_requests" ADD CONSTRAINT "story_bible_change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_world_rules" ADD CONSTRAINT "story_bible_world_rules_story_bible_version_id_story_bible_versions_id_fk" FOREIGN KEY ("story_bible_version_id") REFERENCES "public"."story_bible_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_world_rules" ADD CONSTRAINT "story_bible_world_rules_story_bible_id_story_bibles_id_fk" FOREIGN KEY ("story_bible_id") REFERENCES "public"."story_bibles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_world_rules" ADD CONSTRAINT "story_bible_world_rules_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_world_rules" ADD CONSTRAINT "story_bible_world_rules_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_world_rules" ADD CONSTRAINT "story_bible_world_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_bible_change_requests_user_work_idx" ON "story_bible_change_requests" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "story_bible_change_requests_status_idx" ON "story_bible_change_requests" USING btree ("work_id","branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "story_bible_change_requests_user_idempotency_unique" ON "story_bible_change_requests" USING btree ("user_id","story_bible_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "story_bible_world_rules_version_name_idx" ON "story_bible_world_rules" USING btree ("story_bible_version_id","name");--> statement-breakpoint
CREATE INDEX "story_bible_world_rules_user_work_idx" ON "story_bible_world_rules" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "story_bible_world_rules_branch_idx" ON "story_bible_world_rules" USING btree ("branch_id");--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_action_check" CHECK ("story_bible_versions"."action" in ('proposed', 'edited', 'locked', 'unlocked'));--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_reason_check" CHECK (length(trim("story_bible_versions"."reason")) > 0);--> statement-breakpoint
ALTER TABLE "story_bible_world_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_bible_world_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "story_bible_world_rules_tenant_policy" ON "story_bible_world_rules"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "story_bible_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_bible_change_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "story_bible_change_requests_tenant_policy" ON "story_bible_change_requests"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
