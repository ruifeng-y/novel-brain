CREATE TYPE "public"."system_job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "system_jobs" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."system_job_status";--> statement-breakpoint
ALTER TABLE "system_jobs" ALTER COLUMN "status" SET DATA TYPE "public"."system_job_status" USING "status"::"public"."system_job_status";