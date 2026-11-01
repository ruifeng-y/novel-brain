CREATE TABLE "chapter_outlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_number" integer NOT NULL,
	"chapter_goal" text NOT NULL,
	"pov" text NOT NULL,
	"scene_beats" jsonb NOT NULL,
	"chapter_end_hook" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD CONSTRAINT "chapter_outlines_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_outlines" ADD CONSTRAINT "chapter_outlines_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_outlines_work_branch_chapter_unique" ON "chapter_outlines" USING btree ("work_id","branch_id","chapter_number");