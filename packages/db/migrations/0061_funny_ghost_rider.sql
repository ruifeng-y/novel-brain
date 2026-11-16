DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'work_export_receipts'
			AND column_name = 'artifact_payload'
	) THEN
		ALTER TABLE "work_export_receipts" RENAME COLUMN "artifact_payload" TO "artifact_object_key";
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "work_export_receipts" ALTER COLUMN "source_descriptor" DROP NOT NULL;
