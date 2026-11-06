CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_key_check" CHECK (length(trim("idempotency_records"."idempotency_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_user_scope_key_unique" ON "idempotency_records" USING btree ("user_id","scope","idempotency_key");
--> statement-breakpoint
CREATE INDEX "idempotency_records_resource_idx" ON "idempotency_records" USING btree ("resource_type","resource_id");
--> statement-breakpoint
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "idempotency_records_tenant_policy" ON "idempotency_records"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD COLUMN "impact" jsonb DEFAULT '{"chapterCount":0,"settingRefCount":0,"versionRefCount":0,"total":0,"hasImpact":false,"message":"未发现影响。","resources":[]}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_grants" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_version_check" CHECK ("agent_grants"."version" > 0);
