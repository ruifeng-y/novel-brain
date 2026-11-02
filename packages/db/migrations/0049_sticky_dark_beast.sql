CREATE TABLE "work_purge_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title_hash" text NOT NULL,
	"status" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "work_purge_receipts_work_unique" ON "work_purge_receipts" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "work_purge_receipts_user_purged_idx" ON "work_purge_receipts" USING btree ("user_id","purged_at");--> statement-breakpoint
CREATE INDEX "work_purge_receipts_purged_idx" ON "work_purge_receipts" USING btree ("purged_at");