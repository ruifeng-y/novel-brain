CREATE TYPE "public"."work_branch_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('preparing', 'serializing', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TABLE "work_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"parent_branch_id" uuid,
	"base_commit_id" uuid,
	"status" "work_branch_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pen_name" text NOT NULL,
	"genre_pack" text NOT NULL,
	"scale" text NOT NULL,
	"target_platform" text NOT NULL,
	"status" "work_status" DEFAULT 'preparing' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_branches" ADD CONSTRAINT "work_branches_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_branches" ADD CONSTRAINT "work_branches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_branches_work_id_name_unique" ON "work_branches" USING btree ("work_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "work_branches_one_main_unique" ON "work_branches" USING btree ("work_id") WHERE "work_branches"."is_main" = true;--> statement-breakpoint
CREATE INDEX "work_branches_work_status_idx" ON "work_branches" USING btree ("work_id","status");--> statement-breakpoint
CREATE INDEX "works_user_status_updated_idx" ON "works" USING btree ("user_id","status","updated_at");