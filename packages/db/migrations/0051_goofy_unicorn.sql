ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_status_check";--> statement-breakpoint
ALTER TABLE "import_chunks" ADD COLUMN "start_offset" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD COLUMN "end_offset" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_user_idempotency_unique" ON "import_jobs" USING btree ("user_id","mode","idempotency_key") WHERE "import_jobs"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD CONSTRAINT "import_chunks_offsets_check" CHECK ("import_chunks"."end_offset" >= "import_chunks"."start_offset");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" in ('queued', 'processing', 'awaiting_confirmation', 'paused', 'partial', 'failed', 'cancelled', 'completed'));