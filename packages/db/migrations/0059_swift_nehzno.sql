CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"export_receipt_id" uuid,
	"status" text DEFAULT 'recovery_pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recoverable_until" timestamp with time zone NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"backup_expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"failure" jsonb,
	"store_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_requests_status_check" CHECK ("deletion_requests"."status" in ('recovery_pending', 'purging', 'completed', 'failed', 'recovered')),
	CONSTRAINT "deletion_requests_window_check" CHECK ("deletion_requests"."purge_after" >= "deletion_requests"."recoverable_until" and "deletion_requests"."backup_expires_at" >= "deletion_requests"."purge_after")
);
--> statement-breakpoint
CREATE TABLE "export_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"inventory_version" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"inventory" jsonb NOT NULL,
	"payload" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "export_receipts_schema_version_check" CHECK ("export_receipts"."schema_version" > 0),
	CONSTRAINT "export_receipts_checksum_check" CHECK ("export_receipts"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "export_receipts_byte_size_check" CHECK ("export_receipts"."byte_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_export_receipt_id_export_receipts_id_fk" FOREIGN KEY ("export_receipt_id") REFERENCES "public"."export_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_receipts" ADD CONSTRAINT "export_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_requests_user_created_idx" ON "deletion_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "deletion_requests_due_idx" ON "deletion_requests" USING btree ("status","purge_after");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_requests_user_open_unique" ON "deletion_requests" USING btree ("user_id") WHERE "deletion_requests"."status" in ('recovery_pending', 'purging', 'failed');--> statement-breakpoint
CREATE INDEX "export_receipts_user_generated_idx" ON "export_receipts" USING btree ("user_id","generated_at");--> statement-breakpoint
CREATE INDEX "export_receipts_expires_idx" ON "export_receipts" USING btree ("expires_at");--> statement-breakpoint

ALTER TABLE "export_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "export_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "export_receipts_tenant_policy" ON "export_receipts";--> statement-breakpoint
CREATE POLICY "export_receipts_tenant_policy" ON "export_receipts"
	USING (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) = 'account_deletion'
	)
	WITH CHECK (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) = 'account_deletion'
	);--> statement-breakpoint

ALTER TABLE "deletion_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deletion_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deletion_requests_tenant_policy" ON "deletion_requests";--> statement-breakpoint
CREATE POLICY "deletion_requests_tenant_policy" ON "deletion_requests"
	USING (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) = 'account_deletion'
	)
	WITH CHECK (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) = 'account_deletion'
	);
