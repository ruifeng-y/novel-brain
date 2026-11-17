CREATE TABLE "publish_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"platform_preset" text NOT NULL,
	"status" text NOT NULL,
	"publish_ready" boolean NOT NULL,
	"source_version_node_id" uuid NOT NULL,
	"requested_version_node_id" uuid,
	"manifest_hash" text NOT NULL,
	"platform" jsonb NOT NULL,
	"metadata" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"catalog" jsonb NOT NULL,
	"reader_preview" jsonb NOT NULL,
	"publish_copy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_previews_platform_check" CHECK ("publish_previews"."platform_preset" in ('generic', 'qidian', 'fanqie')),
	CONSTRAINT "publish_previews_status_check" CHECK ("publish_previews"."status" in ('ready', 'warning', 'blocked')),
	CONSTRAINT "publish_previews_manifest_hash_check" CHECK ("publish_previews"."manifest_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "publish_previews_checks_check" CHECK (jsonb_typeof("publish_previews"."checks") = 'array' and jsonb_array_length("publish_previews"."checks") between 1 and 32)
);
--> statement-breakpoint
ALTER TABLE "publish_previews" ADD CONSTRAINT "publish_previews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_previews" ADD CONSTRAINT "publish_previews_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_previews" ADD CONSTRAINT "publish_previews_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_previews" ADD CONSTRAINT "publish_previews_export_id_work_export_receipts_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."work_export_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_previews" ADD CONSTRAINT "publish_previews_source_version_node_id_version_nodes_id_fk" FOREIGN KEY ("source_version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_previews" ADD CONSTRAINT "publish_previews_requested_version_node_id_version_nodes_id_fk" FOREIGN KEY ("requested_version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_previews_user_created_idx" ON "publish_previews" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "publish_previews_work_branch_created_idx" ON "publish_previews" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "publish_previews_export_idx" ON "publish_previews" USING btree ("export_id");--> statement-breakpoint
ALTER TABLE "publish_previews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "publish_previews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "publish_previews_tenant_policy" ON "publish_previews"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
