CREATE TABLE "golden_fingers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"growth_curve" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_ownerships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_entity_id" uuid NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"from_time" text DEFAULT '' NOT NULL,
	"ended_at" text,
	"source" text DEFAULT '作者录入' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_technique_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text DEFAULT 'item' NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "power_system_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"breakthroughs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_eras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"timeline_entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"start_date" jsonb,
	"end_date" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_event_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"timeline_entity_id" uuid NOT NULL,
	"era_id" uuid,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"absolute_date" jsonb,
	"relative_time" text DEFAULT '' NOT NULL,
	"relative_to_node_id" uuid,
	"duration" jsonb,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "golden_fingers" ADD CONSTRAINT "golden_fingers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_fingers" ADD CONSTRAINT "golden_fingers_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_fingers" ADD CONSTRAINT "golden_fingers_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_item_entity_id_entities_id_fk" FOREIGN KEY ("item_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_technique_profiles" ADD CONSTRAINT "item_technique_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_technique_profiles" ADD CONSTRAINT "item_technique_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_technique_profiles" ADD CONSTRAINT "item_technique_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_system_profiles" ADD CONSTRAINT "power_system_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_system_profiles" ADD CONSTRAINT "power_system_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_system_profiles" ADD CONSTRAINT "power_system_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_timeline_entity_id_entities_id_fk" FOREIGN KEY ("timeline_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_timeline_entity_id_entities_id_fk" FOREIGN KEY ("timeline_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_era_id_timeline_eras_id_fk" FOREIGN KEY ("era_id") REFERENCES "public"."timeline_eras"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_relative_to_node_id_timeline_event_nodes_id_fk" FOREIGN KEY ("relative_to_node_id") REFERENCES "public"."timeline_event_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "golden_fingers_owner_name_unique" ON "golden_fingers" USING btree ("work_id","branch_id","owner_entity_id","name");--> statement-breakpoint
CREATE INDEX "golden_fingers_work_branch_idx" ON "golden_fingers" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_ownerships_one_current_unique" ON "item_ownerships" USING btree ("item_entity_id") WHERE "item_ownerships"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "item_ownerships_item_created_idx" ON "item_ownerships" USING btree ("item_entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "item_technique_profiles_entity_unique" ON "item_technique_profiles" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "item_technique_profiles_work_branch_idx" ON "item_technique_profiles" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "power_system_profiles_entity_unique" ON "power_system_profiles" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "power_system_profiles_work_branch_idx" ON "power_system_profiles" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_eras_timeline_name_unique" ON "timeline_eras" USING btree ("timeline_entity_id","name");--> statement-breakpoint
CREATE INDEX "timeline_eras_timeline_created_idx" ON "timeline_eras" USING btree ("timeline_entity_id","created_at");--> statement-breakpoint
CREATE INDEX "timeline_event_nodes_timeline_order_idx" ON "timeline_event_nodes" USING btree ("timeline_entity_id","order_index","created_at");--> statement-breakpoint
CREATE INDEX "timeline_event_nodes_era_idx" ON "timeline_event_nodes" USING btree ("era_id");