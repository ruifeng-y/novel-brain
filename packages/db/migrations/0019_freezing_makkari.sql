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
ALTER TABLE "golden_fingers" ADD CONSTRAINT "golden_fingers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_fingers" ADD CONSTRAINT "golden_fingers_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_fingers" ADD CONSTRAINT "golden_fingers_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "golden_fingers_owner_name_unique" ON "golden_fingers" USING btree ("work_id","branch_id","owner_entity_id","name");--> statement-breakpoint
CREATE INDEX "golden_fingers_work_branch_idx" ON "golden_fingers" USING btree ("work_id","branch_id");