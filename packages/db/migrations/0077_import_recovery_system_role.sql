-- Custom SQL migration file, put your code below! --
CREATE POLICY "import_jobs_import_recovery_policy"
	ON "import_jobs"
	FOR SELECT
	USING (current_setting('app.system_role', true) = 'import_recovery');
--> statement-breakpoint
CREATE POLICY "import_chunks_import_recovery_policy"
	ON "import_chunks"
	FOR SELECT
	USING (current_setting('app.system_role', true) = 'import_recovery');
