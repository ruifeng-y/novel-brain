CREATE TABLE "summary_rebuild_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"level" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_hash" text,
	"output_summary_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "summary_rebuild_items_level_check" CHECK ("summary_rebuild_items"."level" in ('chapter', 'stage', 'volume', 'book')),
	CONSTRAINT "summary_rebuild_items_status_check" CHECK ("summary_rebuild_items"."status" in ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "summary_rebuild_items_ordinal_check" CHECK ("summary_rebuild_items"."ordinal" >= 0),
	CONSTRAINT "summary_rebuild_items_attempts_check" CHECK ("summary_rebuild_items"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "summary_rebuild_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"levels" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"compiler_version" text NOT NULL,
	"model_version" text NOT NULL,
	"checkpoint_revision" integer DEFAULT 0 NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "summary_rebuild_runs_status_check" CHECK ("summary_rebuild_runs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "summary_rebuild_runs_counts_check" CHECK ("summary_rebuild_runs"."checkpoint_revision" >= 0 and "summary_rebuild_runs"."total_items" >= 0 and "summary_rebuild_runs"."completed_items" >= 0 and "summary_rebuild_runs"."completed_items" <= "summary_rebuild_runs"."total_items" and "summary_rebuild_runs"."failed_items" >= 0 and "summary_rebuild_runs"."failed_items" <= "summary_rebuild_runs"."total_items")
);
--> statement-breakpoint
CREATE TABLE "summary_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"chapter_id" uuid,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'stale' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"compiler_version" text NOT NULL,
	"model_version" text NOT NULL,
	"source_ranges" jsonb NOT NULL,
	"from_chapter" integer NOT NULL,
	"to_chapter" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_records_level_check" CHECK ("summary_records"."level" in ('chapter', 'stage', 'volume', 'book')),
	CONSTRAINT "summary_records_status_check" CHECK ("summary_records"."status" in ('fresh', 'stale', 'rebuilding')),
	CONSTRAINT "summary_records_version_check" CHECK ("summary_records"."version" > 0),
	CONSTRAINT "summary_records_content_hash_check" CHECK ("summary_records"."content_hash" ~ '^[a-fA-F0-9]{64}$' and "summary_records"."input_hash" ~ '^[a-fA-F0-9]{64}$'),
	CONSTRAINT "summary_records_range_check" CHECK ("summary_records"."to_chapter" is null or "summary_records"."to_chapter" >= "summary_records"."from_chapter"),
	CONSTRAINT "summary_records_invalidation_check" CHECK (("summary_records"."status" = 'fresh' and "summary_records"."invalidated_at" is null and "summary_records"."invalidation_reason" is null) or ("summary_records"."status" <> 'fresh' and "summary_records"."invalidated_at" is not null and length(trim("summary_records"."invalidation_reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "summary_rebuild_items" ADD CONSTRAINT "summary_rebuild_items_run_id_summary_rebuild_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."summary_rebuild_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rebuild_items" ADD CONSTRAINT "summary_rebuild_items_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rebuild_items" ADD CONSTRAINT "summary_rebuild_items_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rebuild_items" ADD CONSTRAINT "summary_rebuild_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rebuild_items" ADD CONSTRAINT "summary_rebuild_items_output_summary_id_summary_records_id_fk" FOREIGN KEY ("output_summary_id") REFERENCES "public"."summary_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rebuild_runs" ADD CONSTRAINT "summary_rebuild_runs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rebuild_runs" ADD CONSTRAINT "summary_rebuild_runs_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_rebuild_runs" ADD CONSTRAINT "summary_rebuild_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_records" ADD CONSTRAINT "summary_records_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_records" ADD CONSTRAINT "summary_records_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_records" ADD CONSTRAINT "summary_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_records" ADD CONSTRAINT "summary_records_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "summary_rebuild_items_run_ordinal_unique" ON "summary_rebuild_items" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "summary_rebuild_items_run_scope_unique" ON "summary_rebuild_items" USING btree ("run_id","level","scope_id");--> statement-breakpoint
CREATE INDEX "summary_rebuild_items_run_status_idx" ON "summary_rebuild_items" USING btree ("run_id","status","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "summary_rebuild_runs_branch_idempotency_unique" ON "summary_rebuild_runs" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "summary_rebuild_runs_user_work_branch_idx" ON "summary_rebuild_runs" USING btree ("user_id","work_id","branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "summary_records_branch_scope_unique" ON "summary_records" USING btree ("branch_id","level","scope_id");--> statement-breakpoint
CREATE INDEX "summary_records_user_work_branch_status_idx" ON "summary_records" USING btree ("user_id","work_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "summary_records_branch_range_idx" ON "summary_records" USING btree ("branch_id","from_chapter","to_chapter");
--> statement-breakpoint
-- Summary invalidation dependency rule v1:
-- chapter/fact/canon changes invalidate the chapter summary and its ancestors;
-- outline changes invalidate the changed node, its descendants and its ancestors;
-- branch merge/rollback/change-apply invalidates every summary in that branch.
CREATE OR REPLACE FUNCTION "summary_invalidate_chapter"(
	"target_branch_id" uuid,
	"target_chapter_id" uuid,
	"reason" text
) RETURNS void AS $$
BEGIN
	WITH RECURSIVE impacted AS (
		SELECT node."id", node."parent_id"
		FROM "outline_nodes" AS node
		WHERE node."branch_id" = "target_branch_id"
			AND node."level" = 'chapter'
			AND node."chapter_id" = "target_chapter_id"
		UNION
		SELECT parent."id", parent."parent_id"
		FROM "outline_nodes" AS parent
		INNER JOIN impacted AS child ON child."parent_id" = parent."id"
		WHERE parent."branch_id" = "target_branch_id"
	)
	UPDATE "summary_records" AS summary
	SET "status" = 'stale',
		"invalidated_at" = now(),
		"invalidation_reason" = left("reason", 500),
		"updated_at" = now()
	WHERE summary."branch_id" = "target_branch_id"
		AND summary."scope_id" IN (SELECT "id" FROM impacted);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "summary_invalidate_outline_node"(
	"target_branch_id" uuid,
	"target_node_id" uuid,
	"reason" text
) RETURNS void AS $$
BEGIN
	WITH RECURSIVE descendants AS (
		SELECT node."id"
		FROM "outline_nodes" AS node
		WHERE node."branch_id" = "target_branch_id"
			AND node."id" = "target_node_id"
		UNION
		SELECT child."id"
		FROM "outline_nodes" AS child
		INNER JOIN descendants AS parent ON child."parent_id" = parent."id"
		WHERE child."branch_id" = "target_branch_id"
	),
	ancestors AS (
		SELECT node."id", node."parent_id"
		FROM "outline_nodes" AS node
		WHERE node."branch_id" = "target_branch_id"
			AND node."id" = "target_node_id"
		UNION
		SELECT parent."id", parent."parent_id"
		FROM "outline_nodes" AS parent
		INNER JOIN ancestors AS child ON child."parent_id" = parent."id"
		WHERE parent."branch_id" = "target_branch_id"
	)
	UPDATE "summary_records" AS summary
	SET "status" = 'stale',
		"invalidated_at" = now(),
		"invalidation_reason" = left("reason", 500),
		"updated_at" = now()
	WHERE summary."branch_id" = "target_branch_id"
		AND (
			summary."scope_id" IN (SELECT "id" FROM descendants)
			OR summary."scope_id" IN (SELECT "id" FROM ancestors)
		);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "summary_invalidate_branch"(
	"target_branch_id" uuid,
	"reason" text
) RETURNS void AS $$
BEGIN
	UPDATE "summary_records" AS summary
	SET "status" = 'stale',
		"invalidated_at" = now(),
		"invalidation_reason" = left("reason", 500),
		"updated_at" = now()
	WHERE summary."branch_id" = "target_branch_id";
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "summary_chapter_version_invalidation_trigger"() RETURNS trigger AS $$
BEGIN
	PERFORM "summary_invalidate_chapter"(
		NEW."branch_id",
		NEW."chapter_id",
		'chapter_version:' || NEW."id"::text
	);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "summary_fact_invalidation_trigger"() RETURNS trigger AS $$
BEGIN
	PERFORM "summary_invalidate_chapter"(
		NEW."branch_id",
		NEW."chapter_id",
		'fact:' || NEW."id"::text
	);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "summary_canon_invalidation_trigger"() RETURNS trigger AS $$
BEGIN
	PERFORM "summary_invalidate_chapter"(
		NEW."branch_id",
		NEW."chapter_id",
		'canon_commit:' || NEW."id"::text
	);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "summary_outline_invalidation_trigger"() RETURNS trigger AS $$
BEGIN
	PERFORM "summary_invalidate_outline_node"(
		NEW."branch_id",
		NEW."id",
		'outline_node:' || NEW."version"::text
	);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "summary_version_node_invalidation_trigger"() RETURNS trigger AS $$
BEGIN
	IF NEW."node_type" IN ('branch_merge', 'rollback', 'change_apply') THEN
		PERFORM "summary_invalidate_branch"(
			NEW."branch_id",
			NEW."node_type" || ':' || NEW."id"::text
		);
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "summary_chapter_version_invalidation"
	AFTER INSERT ON "chapter_versions"
	FOR EACH ROW EXECUTE FUNCTION "summary_chapter_version_invalidation_trigger"();--> statement-breakpoint
CREATE TRIGGER "summary_fact_invalidation"
	AFTER INSERT OR UPDATE OF "object", "status", "valid_from_chapter", "valid_to_chapter" ON "facts"
	FOR EACH ROW EXECUTE FUNCTION "summary_fact_invalidation_trigger"();--> statement-breakpoint
CREATE TRIGGER "summary_canon_invalidation"
	AFTER INSERT ON "canon_commits"
	FOR EACH ROW EXECUTE FUNCTION "summary_canon_invalidation_trigger"();--> statement-breakpoint
CREATE TRIGGER "summary_outline_invalidation"
	AFTER INSERT OR UPDATE OF "parent_id", "sort_order", "title", "summary", "status", "locked", "version" ON "outline_nodes"
	FOR EACH ROW EXECUTE FUNCTION "summary_outline_invalidation_trigger"();--> statement-breakpoint
CREATE TRIGGER "summary_version_node_invalidation"
	AFTER INSERT ON "version_nodes"
	FOR EACH ROW EXECUTE FUNCTION "summary_version_node_invalidation_trigger"();--> statement-breakpoint
ALTER TABLE "summary_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "summary_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "summary_records_tenant_policy" ON "summary_records"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "summary_rebuild_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "summary_rebuild_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "summary_rebuild_runs_tenant_policy" ON "summary_rebuild_runs"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "summary_rebuild_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "summary_rebuild_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "summary_rebuild_items_tenant_policy" ON "summary_rebuild_items"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
