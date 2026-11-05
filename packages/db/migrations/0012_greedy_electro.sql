ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_mode_check";--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT "works_source_mode_check";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_mode_check" CHECK ("import_jobs"."mode" in ('settings', 'manuscript_text'));--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_source_mode_check" CHECK ("works"."source_mode" in ('idea', 'blank', 'template', 'settings_import', 'manuscript_import'));