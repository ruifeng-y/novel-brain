CREATE TABLE "canon_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"message" text NOT NULL,
	"event_log" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canon_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"commit_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_commits" ADD CONSTRAINT "canon_commits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_snapshots" ADD CONSTRAINT "canon_snapshots_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_snapshots" ADD CONSTRAINT "canon_snapshots_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_snapshots" ADD CONSTRAINT "canon_snapshots_commit_id_canon_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."canon_commits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canon_commits_branch_created_idx" ON "canon_commits" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canon_snapshots_commit_unique" ON "canon_snapshots" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "canon_snapshots_branch_created_idx" ON "canon_snapshots" USING btree ("branch_id","created_at");