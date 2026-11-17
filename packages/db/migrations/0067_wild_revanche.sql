ALTER TABLE "works" DROP CONSTRAINT "works_cover_image_url_check";--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_object_key" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_cover_object_key_check" CHECK ("works"."cover_object_key" is null or "works"."cover_object_key" ~ '^covers/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_trash_window_check" CHECK ("works"."purge_after" is null or ("works"."deleted_at" is not null and "works"."purge_after" > "works"."deleted_at"));--> statement-breakpoint
CREATE OR REPLACE FUNCTION works_cover_image_url_valid(value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  authority text;
  host text;
  port_text text;
BEGIN
  IF value IS NULL THEN
    RETURN true;
  END IF;
  IF value !~ '^https://[^/?#[:space:]]+(?:[/?#][^[:space:]]*)?$' THEN
    RETURN false;
  END IF;
  authority := substring(value from '^https://([^/?#]+)');
  IF authority IS NULL OR position('@' in authority) > 0 THEN
    RETURN false;
  END IF;
  IF authority LIKE '%:%' THEN
    IF length(authority) - length(replace(authority, ':', '')) <> 1 THEN
      RETURN false;
    END IF;
    host := split_part(authority, ':', 1);
    port_text := substring(authority from ':([0-9]+)$');
    IF port_text IS NULL OR port_text::int < 1 OR port_text::int > 65535 THEN
      RETURN false;
    END IF;
  ELSE
    host := authority;
  END IF;
  IF host !~ '^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$' OR host LIKE '%..%' THEN
    RETURN false;
  END IF;
  IF regexp_replace(value, '%[0-9A-Fa-f]{2}', '', 'g') ~ '%' THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_cover_image_url_check" CHECK (works_cover_image_url_valid("works"."cover_image_url"));
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
