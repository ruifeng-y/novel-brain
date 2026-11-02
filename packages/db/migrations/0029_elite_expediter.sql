CREATE TYPE "public"."change_check_status" AS ENUM('passed', 'warning', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."change_check_step" AS ENUM('structure', 'hard_rules', 'fact_diff', 'knowledge_pov', 'narrative', 'downstream');--> statement-breakpoint
CREATE TYPE "public"."change_classification" AS ENUM('safe', 'repairable', 'structural');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('draft', 'analyzing', 'waiting_confirmation', 'applying', 'applied', 'rejected', 'canceled', 'failed', 'branched');--> statement-breakpoint
CREATE TYPE "public"."change_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."change_source" AS ENUM('author', 'ai', 'import', 'batch');--> statement-breakpoint
CREATE TYPE "public"."change_target_type" AS ENUM('entity', 'outline', 'chapter', 'fact', 'knowledge', 'plot_line', 'map', 'faction', 'power_item', 'timeline', 'story_bible', 'work');--> statement-breakpoint
CREATE TABLE "change_impact_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"affected" jsonb NOT NULL,
	"classification" "change_classification" NOT NULL,
	"confidence" real NOT NULL,
	"summary" text NOT NULL,
	"suggestions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"target_type" "change_target_type" NOT NULL,
	"target_id" uuid,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"old_value" jsonb NOT NULL,
	"new_value" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"source" "change_source" NOT NULL,
	"risk" "change_risk" NOT NULL,
	"status" "change_request_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"branched_branch_id" uuid,
	"applied_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"step" "change_check_step" NOT NULL,
	"status" "change_check_status" NOT NULL,
	"summary" text NOT NULL,
	"suggestion" text NOT NULL,
	"confidence" real NOT NULL,
	"ignored" boolean DEFAULT false NOT NULL,
	"ignored_reason" text,
	"ignored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_impact_reports" ADD CONSTRAINT "change_impact_reports_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_branched_branch_id_work_branches_id_fk" FOREIGN KEY ("branched_branch_id") REFERENCES "public"."work_branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_validations" ADD CONSTRAINT "change_validations_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "change_impact_reports_change_unique" ON "change_impact_reports" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "change_requests_work_branch_status_idx" ON "change_requests" USING btree ("work_id","branch_id","status","target_type");--> statement-breakpoint
CREATE INDEX "change_requests_work_branch_created_idx" ON "change_requests" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "change_validations_change_step_unique" ON "change_validations" USING btree ("change_request_id","step");
