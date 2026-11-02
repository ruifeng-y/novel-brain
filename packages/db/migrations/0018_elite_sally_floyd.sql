CREATE TABLE "character_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"desire" text DEFAULT '' NOT NULL,
	"fear" text DEFAULT '' NOT NULL,
	"secret" text DEFAULT '' NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"arc" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_profiles_entity_unique" ON "character_profiles" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "character_profiles_work_branch_idx" ON "character_profiles" USING btree ("work_id","branch_id");