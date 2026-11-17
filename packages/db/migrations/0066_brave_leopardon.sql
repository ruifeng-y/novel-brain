ALTER TABLE "works" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "archived_from_status" text;--> statement-breakpoint
CREATE INDEX "works_user_archived_updated_idx" ON "works" USING btree ("user_id","archived_at","updated_at");--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_request_hash_check" CHECK ("idempotency_records"."request_hash" is null or "idempotency_records"."request_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_version_check" CHECK ("works"."version" > 0);--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_cover_image_url_check" CHECK ("works"."cover_image_url" is null or "works"."cover_image_url" ~ '^https://[^[:space:]]+$');--> statement-breakpoint
CREATE OR REPLACE FUNCTION works_tags_valid(value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value) > 20 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value) AS item
    WHERE jsonb_typeof(item) <> 'string'
      OR length(item #>> '{}') < 1
      OR length(item #>> '{}') > 30
  ) THEN
    RETURN false;
  END IF;
  RETURN (
    SELECT count(*) = count(DISTINCT tag)
    FROM jsonb_array_elements_text(value) AS tag
  );
END;
$$;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_tags_check" CHECK (works_tags_valid("works"."tags"));
