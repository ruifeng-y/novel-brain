CREATE TYPE "public"."foreshadow_importance" AS ENUM('must', 'optional');--> statement-breakpoint
CREATE TYPE "public"."foreshadow_status" AS ENUM('planted', 'paid_off', 'abandoned');--> statement-breakpoint
CREATE TABLE "foreshadows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"setup_chapter" integer,
	"planned_payoff_chapter" integer,
	"status" "foreshadow_status" DEFAULT 'planted' NOT NULL,
	"importance" "foreshadow_importance" DEFAULT 'optional' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "foreshadows_work_branch_status_idx" ON "foreshadows" USING btree ("work_id","branch_id","status");