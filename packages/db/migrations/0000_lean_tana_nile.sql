CREATE TABLE "system_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "system_jobs_type_idx" ON "system_jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "system_jobs_status_idx" ON "system_jobs" USING btree ("status");