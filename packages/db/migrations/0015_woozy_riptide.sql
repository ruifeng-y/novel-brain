CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'author' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_type_check" CHECK ("entities"."type" in ('world_rule', 'character', 'golden_finger')),
	CONSTRAINT "entities_status_check" CHECK ("entities"."status" in ('draft', 'proposed', 'locked', 'discarded')),
	CONSTRAINT "entities_source_check" CHECK ("entities"."source" in ('author', 'import', 'ai', 'canon')),
	CONSTRAINT "entities_lock_metadata_check" CHECK (("entities"."status" = 'locked' and "entities"."locked_at" is not null and "entities"."locked_by" is not null) or ("entities"."status" <> 'locked' and "entities"."locked_at" is null and "entities"."locked_by" is null))
);
--> statement-breakpoint
CREATE TABLE "entity_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "version_nodes" DROP CONSTRAINT "version_nodes_node_type_check";--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_user_work_type_status_idx" ON "entities" USING btree ("user_id","work_id","type","status");--> statement-breakpoint
CREATE INDEX "entities_branch_type_idx" ON "entities" USING btree ("branch_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_versions_entity_version_unique" ON "entity_versions" USING btree ("entity_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_versions_node_unique" ON "entity_versions" USING btree ("version_node_id");--> statement-breakpoint
CREATE INDEX "entity_versions_user_work_idx" ON "entity_versions" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_node_type_check" CHECK ("version_nodes"."node_type" in ('chapter_version', 'outline_version', 'story_bible_version', 'entity_version', 'canon_commit', 'snapshot', 'change_apply', 'branch_merge', 'rollback'));
--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "entities_tenant_policy" ON "entities"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "entity_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "entity_versions_tenant_policy" ON "entity_versions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
