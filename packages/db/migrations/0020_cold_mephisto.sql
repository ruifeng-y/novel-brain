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
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_item_entity_id_entities_id_fk" FOREIGN KEY ("item_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownerships" ADD CONSTRAINT "item_ownerships_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_technique_profiles" ADD CONSTRAINT "item_technique_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_technique_profiles" ADD CONSTRAINT "item_technique_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_technique_profiles" ADD CONSTRAINT "item_technique_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_ownerships_one_current_unique" ON "item_ownerships" USING btree ("item_entity_id") WHERE "item_ownerships"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "item_ownerships_item_created_idx" ON "item_ownerships" USING btree ("item_entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "item_technique_profiles_entity_unique" ON "item_technique_profiles" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "item_technique_profiles_work_branch_idx" ON "item_technique_profiles" USING btree ("work_id","branch_id");