CREATE TABLE "item_rights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"right_type" text NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"holder_label" text,
	"share_percent" real,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"source_chapter_id" uuid,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_rights_type_check" CHECK ("item_rights"."right_type" in ('ownership', 'custody', 'location', 'usage', 'disposal')),
	CONSTRAINT "item_rights_holder_check" CHECK (("item_rights"."right_type" = 'location' and "item_rights"."holder_type" in ('map', 'map_node') and "item_rights"."share_percent" is null) or ("item_rights"."right_type" <> 'location' and "item_rights"."holder_type" in ('character', 'faction', 'item'))),
	CONSTRAINT "item_rights_share_check" CHECK (("item_rights"."right_type" = 'ownership' and "item_rights"."share_percent" is not null and "item_rights"."share_percent" > 0 and "item_rights"."share_percent" <= 100) or ("item_rights"."right_type" <> 'ownership' and "item_rights"."share_percent" is null)),
	CONSTRAINT "item_rights_validity_check" CHECK ("item_rights"."valid_to_chapter" is null or "item_rights"."valid_to_chapter" >= "item_rights"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "item_techniques" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"effect" text NOT NULL,
	"cost" text DEFAULT '' NOT NULL,
	"limits" text DEFAULT '' NOT NULL,
	"ownership_model" text NOT NULL,
	"consumable" boolean DEFAULT false NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"equipment_slot" text,
	"equipped_by_type" text,
	"equipped_by_id" uuid,
	"equipped_by_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_techniques_kind_check" CHECK ("item_techniques"."kind" in ('item', 'technique', 'equipment', 'resource')),
	CONSTRAINT "item_techniques_ownership_model_check" CHECK ("item_techniques"."ownership_model" in ('shared', 'unique')),
	CONSTRAINT "item_techniques_quantity_check" CHECK ("item_techniques"."quantity" >= 0),
	CONSTRAINT "item_techniques_unique_quantity_check" CHECK ("item_techniques"."ownership_model" <> 'unique' or "item_techniques"."quantity" <= 1),
	CONSTRAINT "item_techniques_equipment_check" CHECK (("item_techniques"."kind" = 'equipment' and "item_techniques"."equipment_slot" is not null) or ("item_techniques"."kind" <> 'equipment' and "item_techniques"."equipment_slot" is null and "item_techniques"."equipped_by_type" is null and "item_techniques"."equipped_by_id" is null and "item_techniques"."equipped_by_label" is null))
);
--> statement-breakpoint
CREATE TABLE "mechanism_ownership_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mechanism_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"previous_owner_type" text,
	"previous_owner_id" uuid,
	"previous_owner_label" text,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_label" text,
	"reason" text NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mechanism_ownership_events_owner_check" CHECK ("mechanism_ownership_events"."owner_type" in ('character', 'faction', 'item')),
	CONSTRAINT "mechanism_ownership_events_validity_check" CHECK ("mechanism_ownership_events"."valid_to_chapter" is null or "mechanism_ownership_events"."valid_to_chapter" >= "mechanism_ownership_events"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "power_paths" (
	"id" uuid PRIMARY KEY NOT NULL,
	"power_system_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"path_type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "power_realms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"path_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"breakthrough_conditions" text NOT NULL,
	"breakthrough_costs" text DEFAULT '' NOT NULL,
	"bottlenecks" text DEFAULT '' NOT NULL,
	"counters" text DEFAULT '' NOT NULL,
	"countered_by" text DEFAULT '' NOT NULL,
	"lifespan_amount" integer,
	"prerequisite_realm_id" uuid,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "power_realms_rank_check" CHECK ("power_realms"."rank" > 0),
	CONSTRAINT "power_realms_lifespan_check" CHECK ("power_realms"."lifespan_amount" is null or "power_realms"."lifespan_amount" > 0),
	CONSTRAINT "power_realms_prerequisite_check" CHECK ("power_realms"."prerequisite_realm_id" is null or "power_realms"."prerequisite_realm_id" <> "power_realms"."id")
);
--> statement-breakpoint
CREATE TABLE "power_systems" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"lifespan_mode" text DEFAULT 'none' NOT NULL,
	"lifespan_unit" text DEFAULT '年' NOT NULL,
	"lifespan_basis" text DEFAULT '' NOT NULL,
	"lifespan_description" text DEFAULT '' NOT NULL,
	"lifespan_path_id" uuid,
	"lifespan_fixed_amount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "power_systems_lifespan_mode_check" CHECK ("power_systems"."lifespan_mode" in ('none', 'realm', 'fixed', 'custom')),
	CONSTRAINT "power_systems_lifespan_amount_check" CHECK (("power_systems"."lifespan_mode" = 'fixed' and "power_systems"."lifespan_fixed_amount" is not null and "power_systems"."lifespan_fixed_amount" > 0) or ("power_systems"."lifespan_mode" <> 'fixed' and "power_systems"."lifespan_fixed_amount" is null)),
	CONSTRAINT "power_systems_lifespan_unit_check" CHECK (length(trim("power_systems"."lifespan_unit")) > 0)
);
--> statement-breakpoint
CREATE TABLE "special_mechanisms" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mechanism_type" text NOT NULL,
	"owner_type" text,
	"owner_id" uuid,
	"owner_label" text,
	"power_system_id" uuid,
	"rules" text NOT NULL,
	"costs" text DEFAULT '' NOT NULL,
	"limits" text DEFAULT '' NOT NULL,
	"growth" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_mechanisms_owner_check" CHECK (("special_mechanisms"."owner_type" is null and "special_mechanisms"."owner_id" is null and "special_mechanisms"."owner_label" is null) or ("special_mechanisms"."owner_type" in ('character', 'faction', 'item') and "special_mechanisms"."owner_id" is not null)),
	CONSTRAINT "special_mechanisms_type_check" CHECK (length(trim("special_mechanisms"."mechanism_type")) > 0)
);
--> statement-breakpoint
ALTER TABLE "item_rights" ADD CONSTRAINT "item_rights_item_id_item_techniques_entity_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item_techniques"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_rights" ADD CONSTRAINT "item_rights_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_rights" ADD CONSTRAINT "item_rights_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_rights" ADD CONSTRAINT "item_rights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_rights" ADD CONSTRAINT "item_rights_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_rights" ADD CONSTRAINT "item_rights_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_rights" ADD CONSTRAINT "item_rights_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_techniques" ADD CONSTRAINT "item_techniques_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_techniques" ADD CONSTRAINT "item_techniques_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_techniques" ADD CONSTRAINT "item_techniques_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_techniques" ADD CONSTRAINT "item_techniques_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" ADD CONSTRAINT "mechanism_ownership_events_mechanism_id_special_mechanisms_entity_id_fk" FOREIGN KEY ("mechanism_id") REFERENCES "public"."special_mechanisms"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" ADD CONSTRAINT "mechanism_ownership_events_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" ADD CONSTRAINT "mechanism_ownership_events_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" ADD CONSTRAINT "mechanism_ownership_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" ADD CONSTRAINT "mechanism_ownership_events_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" ADD CONSTRAINT "mechanism_ownership_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_paths" ADD CONSTRAINT "power_paths_power_system_id_power_systems_entity_id_fk" FOREIGN KEY ("power_system_id") REFERENCES "public"."power_systems"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_paths" ADD CONSTRAINT "power_paths_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_paths" ADD CONSTRAINT "power_paths_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_paths" ADD CONSTRAINT "power_paths_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_paths" ADD CONSTRAINT "power_paths_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_paths" ADD CONSTRAINT "power_paths_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_realms" ADD CONSTRAINT "power_realms_path_id_power_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."power_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_realms" ADD CONSTRAINT "power_realms_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_realms" ADD CONSTRAINT "power_realms_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_realms" ADD CONSTRAINT "power_realms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_realms" ADD CONSTRAINT "power_realms_prerequisite_realm_id_power_realms_id_fk" FOREIGN KEY ("prerequisite_realm_id") REFERENCES "public"."power_realms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_realms" ADD CONSTRAINT "power_realms_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_realms" ADD CONSTRAINT "power_realms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_systems" ADD CONSTRAINT "power_systems_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_systems" ADD CONSTRAINT "power_systems_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_systems" ADD CONSTRAINT "power_systems_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_systems" ADD CONSTRAINT "power_systems_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_mechanisms" ADD CONSTRAINT "special_mechanisms_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_mechanisms" ADD CONSTRAINT "special_mechanisms_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_mechanisms" ADD CONSTRAINT "special_mechanisms_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_mechanisms" ADD CONSTRAINT "special_mechanisms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_mechanisms" ADD CONSTRAINT "special_mechanisms_power_system_id_entities_id_fk" FOREIGN KEY ("power_system_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_rights_item_type_valid_idx" ON "item_rights" USING btree ("item_id","right_type","valid_from_chapter");--> statement-breakpoint
CREATE INDEX "item_rights_user_work_idx" ON "item_rights" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "item_techniques_user_work_idx" ON "item_techniques" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "mechanism_ownership_events_mechanism_idx" ON "mechanism_ownership_events" USING btree ("mechanism_id","created_at");--> statement-breakpoint
CREATE INDEX "mechanism_ownership_events_user_work_idx" ON "mechanism_ownership_events" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "power_paths_system_name_unique" ON "power_paths" USING btree ("power_system_id","name");--> statement-breakpoint
CREATE INDEX "power_paths_user_work_idx" ON "power_paths" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "power_realms_path_name_unique" ON "power_realms" USING btree ("path_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "power_realms_path_rank_unique" ON "power_realms" USING btree ("path_id","rank");--> statement-breakpoint
CREATE INDEX "power_realms_user_work_idx" ON "power_realms" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "power_systems_user_work_idx" ON "power_systems" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "power_systems_branch_idx" ON "power_systems" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "special_mechanisms_user_work_idx" ON "special_mechanisms" USING btree ("user_id","work_id");--> statement-breakpoint
INSERT INTO "power_systems" ("entity_id", "work_id", "branch_id", "user_id", "overview", "created_at", "updated_at")
SELECT
	"entity"."id",
	"entity"."work_id",
	"entity"."branch_id",
	"entity"."user_id",
	COALESCE(NULLIF("entity"."attributes"->>'details', ''), "entity"."summary"),
	"entity"."created_at",
	"entity"."updated_at"
FROM "entities" AS "entity"
WHERE "entity"."type" = 'power_system'
ON CONFLICT ("entity_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "special_mechanisms" ("entity_id", "work_id", "branch_id", "user_id", "mechanism_type", "rules", "costs", "limits", "growth", "created_at", "updated_at")
SELECT
	"entity"."id",
	"entity"."work_id",
	"entity"."branch_id",
	"entity"."user_id",
	COALESCE(NULLIF("entity"."attributes"->>'mechanismType', ''), '特殊机制'),
	COALESCE(NULLIF("entity"."attributes"->>'rules', ''), "entity"."summary"),
	COALESCE("entity"."attributes"->>'cost', ''),
	COALESCE("entity"."attributes"->>'limits', ''),
	COALESCE("entity"."attributes"->>'growth', ''),
	"entity"."created_at",
	"entity"."updated_at"
FROM "entities" AS "entity"
WHERE "entity"."type" = 'golden_finger'
ON CONFLICT ("entity_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "item_techniques" ("entity_id", "work_id", "branch_id", "user_id", "kind", "category", "grade", "effect", "cost", "limits", "ownership_model", "consumable", "quantity", "created_at", "updated_at")
SELECT
	"entity"."id",
	"entity"."work_id",
	"entity"."branch_id",
	"entity"."user_id",
	'item',
	COALESCE(NULLIF("entity"."attributes"->>'category', ''), '未分类'),
	COALESCE("entity"."attributes"->>'grade', ''),
	COALESCE(NULLIF("entity"."attributes"->>'effect', ''), "entity"."summary"),
	COALESCE("entity"."attributes"->>'cost', ''),
	COALESCE("entity"."attributes"->>'limits', ''),
	'shared',
	false,
	1,
	"entity"."created_at",
	"entity"."updated_at"
FROM "entities" AS "entity"
WHERE "entity"."type" = 'item'
ON CONFLICT ("entity_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "power_systems" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "power_systems" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "power_systems_tenant_policy" ON "power_systems"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "power_paths" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "power_paths" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "power_paths_tenant_policy" ON "power_paths"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "power_realms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "power_realms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "power_realms_tenant_policy" ON "power_realms"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "special_mechanisms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "special_mechanisms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "special_mechanisms_tenant_policy" ON "special_mechanisms"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mechanism_ownership_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mechanism_ownership_events_tenant_policy" ON "mechanism_ownership_events"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "item_techniques" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_techniques" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "item_techniques_tenant_policy" ON "item_techniques"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "item_rights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_rights" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "item_rights_tenant_policy" ON "item_rights"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
