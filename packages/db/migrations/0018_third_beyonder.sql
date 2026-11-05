CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_version_id" uuid,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"reason" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_decisions_action_check" CHECK ("review_decisions"."action" in ('approve', 'reject'))
);
--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_decisions_chapter_decided_idx" ON "review_decisions" USING btree ("chapter_id","decided_at");--> statement-breakpoint
CREATE INDEX "review_decisions_user_work_idx" ON "review_decisions" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "review_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_decisions_tenant_policy" ON "review_decisions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
