CREATE TYPE "public"."story_arc_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "character_arcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"start_state" text DEFAULT '' NOT NULL,
	"desire" text DEFAULT '' NOT NULL,
	"fear" text DEFAULT '' NOT NULL,
	"lie" text DEFAULT '' NOT NULL,
	"truth" text DEFAULT '' NOT NULL,
	"turn" text DEFAULT '' NOT NULL,
	"end_state" text DEFAULT '' NOT NULL,
	"status" "story_arc_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_arcs_work_branch_character_unique" ON "character_arcs" USING btree ("work_id","branch_id","character_id");--> statement-breakpoint
CREATE INDEX "character_arcs_work_branch_status_idx" ON "character_arcs" USING btree ("work_id","branch_id","status");