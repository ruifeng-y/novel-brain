CREATE TABLE "character_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence" jsonb NOT NULL,
	"idempotency_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_change_requests_kind_check" CHECK ("character_change_requests"."kind" in ('profile', 'relationship', 'state_transition', 'knowledge_state')),
	CONSTRAINT "character_change_requests_status_check" CHECK ("character_change_requests"."status" in ('pending', 'approved', 'rejected', 'applied')),
	CONSTRAINT "character_change_requests_version_check" CHECK ("character_change_requests"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "character_knowledge_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"objective_fact_id" uuid NOT NULL,
	"state" text NOT NULL,
	"claimed_content" text,
	"source_kind" text NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"source_chapter_id" uuid,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_knowledge_states_state_check" CHECK ("character_knowledge_states"."state" in ('knowledge', 'belief', 'suspicion', 'misbelief', 'unknown')),
	CONSTRAINT "character_knowledge_states_source_kind_check" CHECK ("character_knowledge_states"."source_kind" in ('observed', 'told', 'inferred', 'read', 'assumed')),
	CONSTRAINT "character_knowledge_states_content_check" CHECK (("character_knowledge_states"."state" = 'unknown' and "character_knowledge_states"."claimed_content" is null) or ("character_knowledge_states"."state" <> 'unknown' and length(trim(coalesce("character_knowledge_states"."claimed_content", ''))) > 0)),
	CONSTRAINT "character_knowledge_states_validity_check" CHECK ("character_knowledge_states"."valid_to_chapter" is null or "character_knowledge_states"."valid_to_chapter" >= "character_knowledge_states"."valid_from_chapter"),
	CONSTRAINT "character_knowledge_states_from_story_time_check" CHECK (("character_knowledge_states"."from_era" is null and "character_knowledge_states"."from_story_time_label" is null and "character_knowledge_states"."from_story_sort_key" is null) or ("character_knowledge_states"."from_era" is not null and "character_knowledge_states"."from_story_time_label" is not null and "character_knowledge_states"."from_story_sort_key" is not null)),
	CONSTRAINT "character_knowledge_states_to_story_time_check" CHECK (("character_knowledge_states"."to_era" is null and "character_knowledge_states"."to_story_time_label" is null and "character_knowledge_states"."to_story_sort_key" is null) or ("character_knowledge_states"."from_era" is not null and "character_knowledge_states"."to_era" is not null and "character_knowledge_states"."to_story_time_label" is not null and "character_knowledge_states"."to_story_sort_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "character_profiles" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"desire" text DEFAULT '' NOT NULL,
	"fear" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"voice_sample" text DEFAULT '' NOT NULL,
	"voice_guide" text DEFAULT '' NOT NULL,
	"disguise" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_character_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_label" text,
	"relation_type" text NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"source_chapter_id" uuid,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_relationships_relation_type_check" CHECK ("character_relationships"."relation_type" in ('kinship', 'ally', 'enemy', 'mentor', 'student', 'subordinate', 'superior', 'member_of', 'located_at', 'controls', 'owns')),
	CONSTRAINT "character_relationships_target_type_check" CHECK ("character_relationships"."target_type" in ('character', 'faction', 'map', 'map_node', 'power_system', 'golden_finger', 'item', 'timeline_event')),
	CONSTRAINT "character_relationships_validity_check" CHECK ("character_relationships"."valid_to_chapter" is null or "character_relationships"."valid_to_chapter" >= "character_relationships"."valid_from_chapter"),
	CONSTRAINT "character_relationships_from_story_time_check" CHECK (("character_relationships"."from_era" is null and "character_relationships"."from_story_time_label" is null and "character_relationships"."from_story_sort_key" is null) or ("character_relationships"."from_era" is not null and "character_relationships"."from_story_time_label" is not null and "character_relationships"."from_story_sort_key" is not null)),
	CONSTRAINT "character_relationships_to_story_time_check" CHECK (("character_relationships"."to_era" is null and "character_relationships"."to_story_time_label" is null and "character_relationships"."to_story_sort_key" is null) or ("character_relationships"."from_era" is not null and "character_relationships"."to_era" is not null and "character_relationships"."to_story_time_label" is not null and "character_relationships"."to_story_sort_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "character_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"state_kind" text NOT NULL,
	"state_key" text NOT NULL,
	"value" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"target_label" text,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"source_chapter_id" uuid,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_state_transitions_kind_check" CHECK ("character_state_transitions"."state_kind" in ('body', 'limb', 'location', 'ability', 'disguise')),
	CONSTRAINT "character_state_transitions_key_check" CHECK ("character_state_transitions"."state_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "character_state_transitions_validity_check" CHECK ("character_state_transitions"."valid_to_chapter" is null or "character_state_transitions"."valid_to_chapter" >= "character_state_transitions"."valid_from_chapter"),
	CONSTRAINT "character_state_transitions_target_check" CHECK (("character_state_transitions"."state_kind" = 'location' and "character_state_transitions"."target_type" in ('map', 'map_node') and "character_state_transitions"."target_id" is not null) or ("character_state_transitions"."state_kind" <> 'location' and "character_state_transitions"."target_type" is null and "character_state_transitions"."target_id" is null and "character_state_transitions"."target_label" is null)),
	CONSTRAINT "character_state_transitions_from_story_time_check" CHECK (("character_state_transitions"."from_era" is null and "character_state_transitions"."from_story_time_label" is null and "character_state_transitions"."from_story_sort_key" is null) or ("character_state_transitions"."from_era" is not null and "character_state_transitions"."from_story_time_label" is not null and "character_state_transitions"."from_story_sort_key" is not null)),
	CONSTRAINT "character_state_transitions_to_story_time_check" CHECK (("character_state_transitions"."to_era" is null and "character_state_transitions"."to_story_time_label" is null and "character_state_transitions"."to_story_sort_key" is null) or ("character_state_transitions"."from_era" is not null and "character_state_transitions"."to_era" is not null and "character_state_transitions"."to_story_time_label" is not null and "character_state_transitions"."to_story_sort_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "character_change_requests" ADD CONSTRAINT "character_change_requests_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_change_requests" ADD CONSTRAINT "character_change_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_change_requests" ADD CONSTRAINT "character_change_requests_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_change_requests" ADD CONSTRAINT "character_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_change_requests" ADD CONSTRAINT "character_change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_objective_fact_id_facts_id_fk" FOREIGN KEY ("objective_fact_id") REFERENCES "public"."facts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ADD CONSTRAINT "character_knowledge_states_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_source_character_id_entities_id_fk" FOREIGN KEY ("source_character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_transitions" ADD CONSTRAINT "character_state_transitions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_transitions" ADD CONSTRAINT "character_state_transitions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_transitions" ADD CONSTRAINT "character_state_transitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_transitions" ADD CONSTRAINT "character_state_transitions_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_transitions" ADD CONSTRAINT "character_state_transitions_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_transitions" ADD CONSTRAINT "character_state_transitions_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_transitions" ADD CONSTRAINT "character_state_transitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_change_requests_character_idx" ON "character_change_requests" USING btree ("character_id","status");--> statement-breakpoint
CREATE INDEX "character_change_requests_user_work_idx" ON "character_change_requests" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_change_requests_user_idempotency_unique" ON "character_change_requests" USING btree ("user_id","character_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "character_knowledge_states_character_valid_idx" ON "character_knowledge_states" USING btree ("character_id","valid_from_chapter");--> statement-breakpoint
CREATE INDEX "character_knowledge_states_fact_idx" ON "character_knowledge_states" USING btree ("objective_fact_id");--> statement-breakpoint
CREATE INDEX "character_knowledge_states_user_work_idx" ON "character_knowledge_states" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "character_profiles_user_work_idx" ON "character_profiles" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "character_profiles_branch_idx" ON "character_profiles" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "character_relationships_source_valid_idx" ON "character_relationships" USING btree ("source_character_id","valid_from_chapter");--> statement-breakpoint
CREATE INDEX "character_relationships_user_work_idx" ON "character_relationships" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "character_state_transitions_character_valid_idx" ON "character_state_transitions" USING btree ("character_id","valid_from_chapter");--> statement-breakpoint
CREATE INDEX "character_state_transitions_user_work_idx" ON "character_state_transitions" USING btree ("user_id","work_id");--> statement-breakpoint
INSERT INTO "character_profiles" ("entity_id", "work_id", "branch_id", "user_id", "created_at", "updated_at")
SELECT "id", "work_id", "branch_id", "user_id", "created_at", "updated_at"
FROM "entities"
WHERE "type" = 'character'
ON CONFLICT ("entity_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "character_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "character_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "character_profiles_tenant_policy" ON "character_profiles"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "character_relationships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "character_relationships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "character_relationships_tenant_policy" ON "character_relationships"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "character_state_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "character_state_transitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "character_state_transitions_tenant_policy" ON "character_state_transitions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "character_knowledge_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "character_knowledge_states" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "character_knowledge_states_tenant_policy" ON "character_knowledge_states"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "character_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "character_change_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "character_change_requests_tenant_policy" ON "character_change_requests"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
