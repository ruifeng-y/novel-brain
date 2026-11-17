ALTER TABLE "works" DROP CONSTRAINT "works_cover_image_url_check";--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_object_key" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_cover_object_key_check" CHECK ("works"."cover_object_key" is null or "works"."cover_object_key" ~ '^covers/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_trash_window_check" CHECK ("works"."purge_after" is null or ("works"."deleted_at" is not null and "works"."purge_after" > "works"."deleted_at"));--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_cover_image_url_check" CHECK ("works"."cover_image_url" is null or "works"."cover_image_url" ~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?(?:/[^[:space:]]*)?$');
DROP POLICY IF EXISTS "works_tenant_policy" ON "works";--> statement-breakpoint
CREATE POLICY "works_tenant_policy" ON "works"
	USING (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) = 'work_deletion'
	)
	WITH CHECK (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) = 'work_deletion'
	);--> statement-breakpoint
DROP POLICY IF EXISTS "work_export_receipts_tenant_policy" ON "work_export_receipts";--> statement-breakpoint
CREATE POLICY "work_export_receipts_tenant_policy" ON "work_export_receipts"
	USING (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) in (
			'account_deletion',
			'work_export_cleanup',
			'work_deletion'
		)
	)
	WITH CHECK (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) in (
			'account_deletion',
			'work_export_cleanup',
			'work_deletion'
		)
	);
