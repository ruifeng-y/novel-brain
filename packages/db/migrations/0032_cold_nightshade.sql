CREATE TABLE "branch_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"snapshot_branch_id" uuid NOT NULL,
	"chapter_version_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_id_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fork_branch_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "is_snapshot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "baseline_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "baseline_materialized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD CONSTRAINT "branch_commits_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD CONSTRAINT "branch_commits_source_branch_id_work_branches_id_fk" FOREIGN KEY ("source_branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD CONSTRAINT "branch_commits_snapshot_branch_id_work_branches_id_fk" FOREIGN KEY ("snapshot_branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD CONSTRAINT "branch_commits_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_commits" ADD CONSTRAINT "branch_commits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_id_mappings" ADD CONSTRAINT "branch_id_mappings_fork_branch_id_work_branches_id_fk" FOREIGN KEY ("fork_branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_commits_chapter_version_unique" ON "branch_commits" USING btree ("chapter_version_id");--> statement-breakpoint
CREATE INDEX "branch_commits_source_created_idx" ON "branch_commits" USING btree ("source_branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_id_mappings_fork_source_unique" ON "branch_id_mappings" USING btree ("fork_branch_id","source_id");--> statement-breakpoint
CREATE INDEX "branch_id_mappings_fork_table_idx" ON "branch_id_mappings" USING btree ("fork_branch_id","table_name");