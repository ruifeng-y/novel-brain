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
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_timeline_entity_id_entities_id_fk" FOREIGN KEY ("timeline_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_timeline_entity_id_entities_id_fk" FOREIGN KEY ("timeline_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_era_id_timeline_eras_id_fk" FOREIGN KEY ("era_id") REFERENCES "public"."timeline_eras"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_nodes" ADD CONSTRAINT "timeline_event_nodes_relative_to_node_id_timeline_event_nodes_id_fk" FOREIGN KEY ("relative_to_node_id") REFERENCES "public"."timeline_event_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_eras_timeline_name_unique" ON "timeline_eras" USING btree ("timeline_entity_id","name");--> statement-breakpoint
CREATE INDEX "timeline_eras_timeline_created_idx" ON "timeline_eras" USING btree ("timeline_entity_id","created_at");--> statement-breakpoint
CREATE INDEX "timeline_event_nodes_timeline_order_idx" ON "timeline_event_nodes" USING btree ("timeline_entity_id","order_index","created_at");--> statement-breakpoint
CREATE INDEX "timeline_event_nodes_era_idx" ON "timeline_event_nodes" USING btree ("era_id");