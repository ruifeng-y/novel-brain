CREATE TABLE "story_bible_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"story_bible_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"cards" jsonb NOT NULL,
	"readiness" jsonb NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_bible_versions_nine_cards_check" CHECK (jsonb_array_length("story_bible_versions"."cards") = 9)
);
--> statement-breakpoint
CREATE TABLE "story_bibles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cards" jsonb NOT NULL,
	"proposal_generated_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_bibles_status_check" CHECK ("story_bibles"."status" in ('draft', 'proposed', 'locked')),
	CONSTRAINT "story_bibles_nine_cards_check" CHECK (jsonb_array_length("story_bibles"."cards") = 9),
	CONSTRAINT "story_bibles_lock_metadata_check" CHECK (("story_bibles"."status" = 'locked' and "story_bibles"."locked_at" is not null and "story_bibles"."locked_by" is not null) or ("story_bibles"."status" <> 'locked' and "story_bibles"."locked_at" is null and "story_bibles"."locked_by" is null))
);
--> statement-breakpoint
ALTER TABLE "version_nodes" DROP CONSTRAINT "version_nodes_node_type_check";--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_story_bible_id_story_bibles_id_fk" FOREIGN KEY ("story_bible_id") REFERENCES "public"."story_bibles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_versions" ADD CONSTRAINT "story_bible_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD CONSTRAINT "story_bibles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD CONSTRAINT "story_bibles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD CONSTRAINT "story_bibles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD CONSTRAINT "story_bibles_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_bible_versions_bible_version_unique" ON "story_bible_versions" USING btree ("story_bible_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "story_bible_versions_node_unique" ON "story_bible_versions" USING btree ("version_node_id");--> statement-breakpoint
CREATE INDEX "story_bible_versions_user_work_idx" ON "story_bible_versions" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_bibles_work_branch_unique" ON "story_bibles" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE INDEX "story_bibles_user_work_idx" ON "story_bibles" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_node_type_check" CHECK ("version_nodes"."node_type" in ('chapter_version', 'outline_version', 'story_bible_version', 'canon_commit', 'snapshot', 'change_apply', 'branch_merge', 'rollback'));--> statement-breakpoint
ALTER TABLE "story_bibles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_bibles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "story_bibles_tenant_policy" ON "story_bibles"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "story_bible_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_bible_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "story_bible_versions_tenant_policy" ON "story_bible_versions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
