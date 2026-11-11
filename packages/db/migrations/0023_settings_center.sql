CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"applies_to" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relation_target" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_type_check" CHECK ("custom_field_definitions"."field_type" in ('text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'boolean', 'relation_ref')),
	CONSTRAINT "custom_field_definitions_applies_to_check" CHECK ("custom_field_definitions"."applies_to" in ('all', 'world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event')),
	CONSTRAINT "custom_field_definitions_relation_target_check" CHECK ("custom_field_definitions"."relation_target" is null or "custom_field_definitions"."relation_target" in ('world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event')),
	CONSTRAINT "custom_field_definitions_schema_version_check" CHECK ("custom_field_definitions"."schema_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"field_definition_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_version" integer NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"conflict_type" text DEFAULT 'none' NOT NULL,
	"evidence" jsonb NOT NULL,
	"idempotency_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_change_requests_status_check" CHECK ("setting_change_requests"."status" in ('pending', 'approved', 'rejected', 'applied')),
	CONSTRAINT "setting_change_requests_conflict_type_check" CHECK ("setting_change_requests"."conflict_type" in ('none', 'duplicate_name', 'alias_collision', 'contradictory_fact', 'import_candidate', 'ai_disagreement'))
);
--> statement-breakpoint
CREATE TABLE "setting_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"conflict_type" text DEFAULT 'none' NOT NULL,
	"evidence" jsonb NOT NULL,
	"reason" text NOT NULL,
	"proposed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"decision_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_conflict_type" text,
	CONSTRAINT "setting_proposals_status_check" CHECK ("setting_proposals"."status" in ('pending', 'accepted', 'rejected')),
	CONSTRAINT "setting_proposals_conflict_type_check" CHECK ("setting_proposals"."conflict_type" in ('none', 'duplicate_name', 'alias_collision', 'contradictory_fact', 'import_candidate', 'ai_disagreement')),
	CONSTRAINT "setting_proposals_decision_conflict_type_check" CHECK ("setting_proposals"."decision_conflict_type" is null or "setting_proposals"."decision_conflict_type" in ('none', 'duplicate_name', 'alias_collision', 'contradictory_fact', 'import_candidate', 'ai_disagreement')),
	CONSTRAINT "setting_proposals_decision_metadata_check" CHECK (("setting_proposals"."status" = 'pending' and "setting_proposals"."decided_by" is null and "setting_proposals"."decided_at" is null and "setting_proposals"."decision_reason" is null) or ("setting_proposals"."status" <> 'pending' and "setting_proposals"."decided_by" is not null and "setting_proposals"."decided_at" is not null and "setting_proposals"."decision_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT "entities_type_check";--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_proposals" ADD CONSTRAINT "setting_proposals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_proposals" ADD CONSTRAINT "setting_proposals_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_proposals" ADD CONSTRAINT "setting_proposals_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_proposals" ADD CONSTRAINT "setting_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_proposals" ADD CONSTRAINT "setting_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_proposals" ADD CONSTRAINT "setting_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_scope_key_unique" ON "custom_field_definitions" USING btree ("work_id","branch_id","key");--> statement-breakpoint
CREATE INDEX "custom_field_definitions_user_work_idx" ON "custom_field_definitions" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_field_entity_unique" ON "custom_field_values" USING btree ("field_definition_id","entity_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_entity_idx" ON "custom_field_values" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_user_work_idx" ON "custom_field_values" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "setting_change_requests_entity_idx" ON "setting_change_requests" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "setting_change_requests_user_work_idx" ON "setting_change_requests" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_change_requests_user_entity_idempotency_unique" ON "setting_change_requests" USING btree ("user_id","entity_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "setting_proposals_entity_idx" ON "setting_proposals" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "setting_proposals_user_work_status_idx" ON "setting_proposals" USING btree ("user_id","work_id","status");--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_type_check" CHECK ("entities"."type" in ('world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event'));--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "custom_field_definitions_tenant_policy" ON "custom_field_definitions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "custom_field_values_tenant_policy" ON "custom_field_values"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "setting_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setting_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "setting_proposals_tenant_policy" ON "setting_proposals"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "setting_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setting_change_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "setting_change_requests_tenant_policy" ON "setting_change_requests"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
