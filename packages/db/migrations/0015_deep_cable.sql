CREATE TYPE "public"."story_bible_change_kind" AS ENUM('saved', 'locked', 'locked_change');--> statement-breakpoint
CREATE TABLE "story_bible_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"story_bible_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "story_bible_change_kind" NOT NULL,
	"reason" text NOT NULL,
	"changed_cards" jsonb NOT NULL,
	"before_cards" jsonb NOT NULL,
	"after_cards" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_bible_revisions" ADD CONSTRAINT "story_bible_revisions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_revisions" ADD CONSTRAINT "story_bible_revisions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_revisions" ADD CONSTRAINT "story_bible_revisions_story_bible_id_story_bibles_id_fk" FOREIGN KEY ("story_bible_id") REFERENCES "public"."story_bibles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_revisions" ADD CONSTRAINT "story_bible_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_bible_revisions_branch_created_idx" ON "story_bible_revisions" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "story_bible_revisions_bible_created_idx" ON "story_bible_revisions" USING btree ("story_bible_id","created_at");