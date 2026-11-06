CREATE TABLE "outline_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"chapter_id" uuid,
	"tension" integer,
	"version_node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outline_nodes_level_check" CHECK ("outline_nodes"."level" in ('book', 'volume', 'act', 'chapter', 'scene')),
	CONSTRAINT "outline_nodes_status_check" CHECK ("outline_nodes"."status" in ('planned', 'active', 'done')),
	CONSTRAINT "outline_nodes_tension_check" CHECK ("outline_nodes"."tension" is null or ("outline_nodes"."tension" >= 0 and "outline_nodes"."tension" <= 100)),
	CONSTRAINT "outline_nodes_parent_check" CHECK (("outline_nodes"."level" = 'book' and "outline_nodes"."parent_id" is null) or ("outline_nodes"."level" <> 'book' and "outline_nodes"."parent_id" is not null)),
	CONSTRAINT "outline_nodes_chapter_check" CHECK (("outline_nodes"."level" = 'chapter' and "outline_nodes"."chapter_id" is not null) or ("outline_nodes"."level" <> 'chapter' and "outline_nodes"."chapter_id" is null))
);
--> statement-breakpoint
CREATE TABLE "scene_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pov_type" text,
	"pov_id" uuid,
	"pov_branch_id" uuid,
	"pov_label" text,
	"pov_version_node_id" uuid,
	"pov_object_version" integer,
	"location_type" text,
	"location_id" uuid,
	"location_branch_id" uuid,
	"location_label" text,
	"location_version_node_id" uuid,
	"location_object_version" integer,
	"story_era" text,
	"story_time_label" text,
	"story_sort_key" integer,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"information_releases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tension" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_cards_pov_check" CHECK (("scene_cards"."pov_type" is null and "scene_cards"."pov_id" is null and "scene_cards"."pov_branch_id" is null) or ("scene_cards"."pov_type" is not null and "scene_cards"."pov_id" is not null and "scene_cards"."pov_branch_id" is not null)),
	CONSTRAINT "scene_cards_location_check" CHECK (("scene_cards"."location_type" is null and "scene_cards"."location_id" is null and "scene_cards"."location_branch_id" is null) or ("scene_cards"."location_type" is not null and "scene_cards"."location_id" is not null and "scene_cards"."location_branch_id" is not null)),
	CONSTRAINT "scene_cards_story_time_check" CHECK (("scene_cards"."story_era" is null and "scene_cards"."story_time_label" is null and "scene_cards"."story_sort_key" is null) or ("scene_cards"."story_era" is not null and "scene_cards"."story_time_label" is not null and "scene_cards"."story_sort_key" is not null)),
	CONSTRAINT "scene_cards_tension_check" CHECK ("scene_cards"."tension" is null or ("scene_cards"."tension" >= 0 and "scene_cards"."tension" <= 100))
);
--> statement-breakpoint
CREATE TABLE "volume_contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"conflict" text NOT NULL,
	"turning_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exit_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plot_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_parent_id_outline_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."outline_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_cards" ADD CONSTRAINT "scene_cards_node_id_outline_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."outline_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_cards" ADD CONSTRAINT "scene_cards_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_cards" ADD CONSTRAINT "scene_cards_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_cards" ADD CONSTRAINT "scene_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_cards" ADD CONSTRAINT "scene_cards_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_contracts" ADD CONSTRAINT "volume_contracts_node_id_outline_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."outline_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_contracts" ADD CONSTRAINT "volume_contracts_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_contracts" ADD CONSTRAINT "volume_contracts_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_contracts" ADD CONSTRAINT "volume_contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_contracts" ADD CONSTRAINT "volume_contracts_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outline_nodes_user_work_idx" ON "outline_nodes" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "outline_nodes_branch_parent_idx" ON "outline_nodes" USING btree ("branch_id","parent_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "outline_nodes_parent_order_unique" ON "outline_nodes" USING btree ("branch_id",coalesce("parent_id"::text, 'root'),"sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "outline_nodes_branch_chapter_unique" ON "outline_nodes" USING btree ("branch_id","chapter_id") WHERE "outline_nodes"."chapter_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "outline_nodes_branch_book_unique" ON "outline_nodes" USING btree ("branch_id") WHERE "outline_nodes"."level" = 'book';--> statement-breakpoint
CREATE UNIQUE INDEX "scene_cards_node_unique" ON "scene_cards" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "scene_cards_user_work_idx" ON "scene_cards" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "volume_contracts_node_unique" ON "volume_contracts" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "volume_contracts_user_work_idx" ON "volume_contracts" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "outline_nodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outline_nodes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "outline_nodes_tenant_policy" ON "outline_nodes"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "volume_contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "volume_contracts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "volume_contracts_tenant_policy" ON "volume_contracts"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "scene_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scene_cards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "scene_cards_tenant_policy" ON "scene_cards"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
