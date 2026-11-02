CREATE TYPE "public"."fact_proposal_status" AS ENUM('proposed', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."fact_type" AS ENUM('event', 'body_state', 'character_knowledge');--> statement-breakpoint
CREATE TABLE "fact_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"generation_request_id" uuid,
	"type" "fact_type" NOT NULL,
	"statement" text NOT NULL,
	"source_sentence" text NOT NULL,
	"status" "fact_proposal_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_proposals" ADD CONSTRAINT "fact_proposals_generation_request_id_generation_requests_id_fk" FOREIGN KEY ("generation_request_id") REFERENCES "public"."generation_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_proposals_chapter_status_idx" ON "fact_proposals" USING btree ("chapter_id","status");--> statement-breakpoint
CREATE INDEX "fact_proposals_branch_created_idx" ON "fact_proposals" USING btree ("branch_id","created_at");