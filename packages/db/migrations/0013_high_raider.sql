CREATE TABLE "chapter_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"version_node_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"current_version_id" uuid,
	"word_count" integer DEFAULT 0 NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_status_check" CHECK ("chapters"."status" in ('planned', 'writing', 'waiting_review', 'changes_requested', 'approved', 'locked', 'published', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_current_version_id_chapter_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_versions_chapter_version_unique" ON "chapter_versions" USING btree ("chapter_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_versions_node_unique" ON "chapter_versions" USING btree ("version_node_id");--> statement-breakpoint
CREATE INDEX "chapter_versions_user_work_idx" ON "chapter_versions" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_work_branch_number_unique" ON "chapters" USING btree ("work_id","branch_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_current_version_unique" ON "chapters" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "chapters_user_work_idx" ON "chapters" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "chapters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chapters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "chapters_tenant_policy" ON "chapters"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "chapter_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chapter_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "chapter_versions_tenant_policy" ON "chapter_versions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
