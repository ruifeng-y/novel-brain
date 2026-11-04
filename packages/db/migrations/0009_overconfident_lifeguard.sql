CREATE TABLE "genre_packs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"label" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "genre_packs_key_check" CHECK ("genre_packs"."key" in ('xianxia', 'history', 'urban'))
);
--> statement-breakpoint
INSERT INTO "genre_packs" ("id", "key", "version", "label", "fields") VALUES (
	'01a1a6f9-9d9b-7000-8000-000000000001',
	'xianxia',
	1,
	'仙侠模板',
	'{"genre":"仙侠","world":"修真文明","map":"分层地图","powerSystem":"修炼体系","factions":"宗门势力","specialElements":["灵物","记忆代价"]}'::jsonb
);
--> statement-breakpoint
ALTER TABLE "version_nodes" ADD COLUMN "snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "template_pack_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "genre_packs_key_version_unique" ON "genre_packs" USING btree ("key","version");--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_parent_node_id_version_nodes_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_branches" ADD CONSTRAINT "work_branches_head_node_id_version_nodes_id_fk" FOREIGN KEY ("head_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_template_pack_id_genre_packs_id_fk" FOREIGN KEY ("template_pack_id") REFERENCES "public"."genre_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_branches_head_node_unique" ON "work_branches" USING btree ("head_node_id");--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_node_type_check" CHECK ("version_nodes"."node_type" in ('chapter_version', 'outline_version', 'canon_commit', 'snapshot', 'change_apply', 'branch_merge', 'rollback'));--> statement-breakpoint
ALTER TABLE "work_branches" ADD CONSTRAINT "work_branches_status_check" CHECK ("work_branches"."status" in ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_status_check" CHECK ("works"."status" in ('draft', 'preparing', 'serializing', 'paused', 'completed', 'archived'));--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_genre_check" CHECK ("works"."genre" in ('xianxia', 'history', 'urban'));--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_scale_target_check" CHECK ("works"."scale_target" in ('short', 'medium', 'long', 'epic'));--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_source_mode_check" CHECK ("works"."source_mode" in ('idea', 'blank', 'template'));--> statement-breakpoint
ALTER TABLE "works" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "works" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "works_tenant_policy" ON "works"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "work_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_branches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "work_branches_tenant_policy" ON "work_branches"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "version_nodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "version_nodes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "version_nodes_tenant_policy" ON "version_nodes"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
