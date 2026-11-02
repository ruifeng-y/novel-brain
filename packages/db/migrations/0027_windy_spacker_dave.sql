ALTER TABLE "entities" ADD COLUMN "subtype" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "genre_variant" text;--> statement-breakpoint
CREATE INDEX "entities_work_branch_subtype_idx" ON "entities" USING btree ("work_id","branch_id","subtype");