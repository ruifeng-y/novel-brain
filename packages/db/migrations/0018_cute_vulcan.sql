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
ALTER TABLE "power_system_profiles" ADD CONSTRAINT "power_system_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_system_profiles" ADD CONSTRAINT "power_system_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_system_profiles" ADD CONSTRAINT "power_system_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "power_system_profiles_entity_unique" ON "power_system_profiles" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "power_system_profiles_work_branch_idx" ON "power_system_profiles" USING btree ("work_id","branch_id");