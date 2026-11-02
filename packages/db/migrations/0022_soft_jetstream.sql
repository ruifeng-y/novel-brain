CREATE TYPE "public"."outline_level" AS ENUM('book', 'volume', 'act', 'chapter', 'scene');--> statement-breakpoint
DROP INDEX "chapter_outlines_work_branch_chapter_unique";--> statement-breakpoint
ALTER TABLE "chapter_outlines" ALTER COLUMN "chapter_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ALTER COLUMN "chapter_goal" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "chapter_outlines" ALTER COLUMN "pov" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "chapter_outlines" ALTER COLUMN "scene_beats" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ALTER COLUMN "chapter_end_hook" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "level" "outline_level" DEFAULT 'chapter' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "order_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "details" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "chapter_outlines"
SET "title" = '第 ' || "chapter_number" || ' 章',
    "summary" = "chapter_goal",
    "order_index" = "chapter_number" - 1
WHERE "chapter_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD CONSTRAINT "chapter_outlines_parent_id_chapter_outlines_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."chapter_outlines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD CONSTRAINT "chapter_outlines_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_outlines_one_book_unique" ON "chapter_outlines" USING btree ("work_id","branch_id") WHERE "chapter_outlines"."level" = 'book';--> statement-breakpoint
CREATE INDEX "chapter_outlines_work_branch_parent_order_idx" ON "chapter_outlines" USING btree ("work_id","branch_id","parent_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_outlines_work_branch_chapter_unique" ON "chapter_outlines" USING btree ("work_id","branch_id","chapter_number") WHERE "chapter_outlines"."chapter_number" is not null;
