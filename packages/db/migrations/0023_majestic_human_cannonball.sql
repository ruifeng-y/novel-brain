CREATE TYPE "public"."story_thread_status" AS ENUM('active', 'resolved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."story_thread_type" AS ENUM('main', 'sub', 'character', 'faction', 'mystery', 'romance');--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "story_thread_type" NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"stakes" text NOT NULL,
	"participant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_payoff_chapter" integer,
	"status" "story_thread_status" DEFAULT 'active' NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tension_curve" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threads_work_branch_type_status_idx" ON "threads" USING btree ("work_id","branch_id","type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_work_branch_name_unique" ON "threads" USING btree ("work_id","branch_id","name");