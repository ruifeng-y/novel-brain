CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_documents_uuid_v7"() RETURNS uuid AS $$
DECLARE
	ts_ms bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
	bytes bytea := uuid_send(gen_random_uuid());
BEGIN
	bytes := overlay(bytes placing substring(int8send(ts_ms) FROM 3) FROM 1 FOR 6);
	bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
	bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
	RETURN encode(bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TABLE "search_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"entity_type" text,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version_node_id" uuid NOT NULL,
	"object_version" integer NOT NULL,
	"source_chapter_id" uuid,
	"from_chapter" integer NOT NULL,
	"to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_documents_source_type_check" CHECK ("search_documents"."source_type" in ('entity', 'fact', 'timeline_event', 'map_node')),
	CONSTRAINT "search_documents_entity_type_check" CHECK ("search_documents"."entity_type" is null or "search_documents"."entity_type" in ('world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event')),
	CONSTRAINT "search_documents_validity_check" CHECK ("search_documents"."to_chapter" is null or "search_documents"."to_chapter" >= "search_documents"."from_chapter"),
	CONSTRAINT "search_documents_from_story_time_check" CHECK (("search_documents"."from_era" is null and "search_documents"."from_story_time_label" is null and "search_documents"."from_story_sort_key" is null) or ("search_documents"."from_era" is not null and "search_documents"."from_story_time_label" is not null and "search_documents"."from_story_sort_key" is not null)),
	CONSTRAINT "search_documents_to_story_time_check" CHECK (("search_documents"."to_era" is null and "search_documents"."to_story_time_label" is null and "search_documents"."to_story_sort_key" is null) or ("search_documents"."from_era" is not null and "search_documents"."to_era" is not null and "search_documents"."to_story_time_label" is not null and "search_documents"."to_story_sort_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_documents_source_version_unique" ON "search_documents" USING btree ("branch_id","source_type","source_id","version_node_id");--> statement-breakpoint
CREATE INDEX "search_documents_user_work_branch_idx" ON "search_documents" USING btree ("user_id","work_id","branch_id","source_type");--> statement-breakpoint
CREATE INDEX "search_documents_branch_chapter_idx" ON "search_documents" USING btree ("branch_id","from_chapter","to_chapter");--> statement-breakpoint
ALTER TABLE "search_documents" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (
	to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", ''))
) STORED;--> statement-breakpoint
CREATE INDEX "search_documents_tsv_idx" ON "search_documents" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_documents_trgm_idx" ON "search_documents" USING gin (
	(
		lower(
			"title" || ' ' || coalesce("content", '') || ' ' || "aliases"::text
		)
	) gin_trgm_ops
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_documents_upsert_entity"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "search_documents" (
		"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		"search_documents_uuid_v7"(), entity."work_id", entity."branch_id", entity."user_id",
		'entity', entity."id", entity."type", entity."name",
		trim(entity."summary" || ' ' || entity."description"), entity."aliases",
		NEW."version_node_id", NEW."version", NULL, 1, NULL,
		NULL, NULL, NULL, NULL, NULL, NULL,
		jsonb_build_object('status', entity."status", 'source', entity."source"),
		now(), now()
	FROM "entities" AS entity
	WHERE entity."id" = NEW."entity_id"
		AND entity."type" <> 'timeline_event'
		AND entity."deleted_at" IS NULL
	ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO UPDATE SET
		"entity_type" = excluded."entity_type",
		"title" = excluded."title",
		"content" = excluded."content",
		"aliases" = excluded."aliases",
		"metadata" = excluded."metadata",
		"updated_at" = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_documents_delete_entity"() RETURNS trigger AS $$
BEGIN
	IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
		DELETE FROM "search_documents"
		WHERE "source_id" = NEW."id" AND "source_type" IN ('entity', 'timeline_event');
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_documents_upsert_fact"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "search_documents" (
		"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		"search_documents_uuid_v7"(), fact."work_id", fact."branch_id", fact."user_id",
		'fact', fact."id", NULL, fact."subject",
		trim(fact."predicate" || ' ' || fact."object"), '[]'::jsonb,
		commit."version_node_id", 1, fact."chapter_id",
		fact."valid_from_chapter", fact."valid_to_chapter",
		NULL, NULL, NULL, NULL, NULL, NULL,
		jsonb_build_object('status', fact."status", 'risk', fact."risk"),
		now(), now()
	FROM "facts" AS fact
	INNER JOIN "canon_commits" AS commit ON commit."id" = fact."canon_commit_id"
	WHERE fact."id" = NEW."id"
	ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO UPDATE SET
		"title" = excluded."title",
		"content" = excluded."content",
		"source_chapter_id" = excluded."source_chapter_id",
		"from_chapter" = excluded."from_chapter",
		"to_chapter" = excluded."to_chapter",
		"metadata" = excluded."metadata",
		"updated_at" = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_documents_upsert_timeline_event"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "search_documents" (
		"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		"search_documents_uuid_v7"(), event."work_id", event."branch_id", event."user_id",
		'timeline_event', event."id", 'timeline_event', entity."name", event."event_text",
		entity."aliases", event."version_node_id", 1, NULL,
		event."valid_from_chapter", event."valid_to_chapter",
		event."era", event."story_time_label", event."story_time_sort_key",
		NULL, NULL, NULL,
		jsonb_build_object(
			'status', entity."status",
			'era', event."era",
			'storyTimeSortKey', event."story_time_sort_key"
		),
		now(), now()
	FROM "timeline_events" AS event
	INNER JOIN "entities" AS entity ON entity."id" = event."id"
	WHERE event."id" = NEW."id" AND entity."deleted_at" IS NULL
	ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO UPDATE SET
		"title" = excluded."title",
		"content" = excluded."content",
		"aliases" = excluded."aliases",
		"from_chapter" = excluded."from_chapter",
		"to_chapter" = excluded."to_chapter",
		"from_era" = excluded."from_era",
		"from_story_time_label" = excluded."from_story_time_label",
		"from_story_sort_key" = excluded."from_story_sort_key",
		"to_era" = excluded."to_era",
		"to_story_time_label" = excluded."to_story_time_label",
		"to_story_sort_key" = excluded."to_story_sort_key",
		"metadata" = excluded."metadata",
		"updated_at" = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_documents_upsert_map_node"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "search_documents" (
		"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		"search_documents_uuid_v7"(), node."work_id", node."branch_id", node."user_id",
		'map_node', node."id", 'map', node."name", node."summary", '[]'::jsonb,
		node."version_node_id", 1, NULL,
		node."valid_from_chapter", node."valid_to_chapter",
		node."from_era", node."from_story_time_label", node."from_story_sort_key",
		node."to_era", node."to_story_time_label", node."to_story_sort_key",
		jsonb_build_object('nodeType', node."node_type", 'mapId', node."map_id"),
		now(), now()
	FROM "map_nodes" AS node
	WHERE node."id" = NEW."id"
	ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO UPDATE SET
		"title" = excluded."title",
		"content" = excluded."content",
		"from_chapter" = excluded."from_chapter",
		"to_chapter" = excluded."to_chapter",
		"from_era" = excluded."from_era",
		"from_story_time_label" = excluded."from_story_time_label",
		"from_story_sort_key" = excluded."from_story_sort_key",
		"to_era" = excluded."to_era",
		"to_story_time_label" = excluded."to_story_time_label",
		"to_story_sort_key" = excluded."to_story_sort_key",
		"metadata" = excluded."metadata",
		"updated_at" = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "search_documents_entity_version_trigger"
	AFTER INSERT ON "entity_versions"
	FOR EACH ROW EXECUTE FUNCTION "search_documents_upsert_entity"();--> statement-breakpoint
CREATE TRIGGER "search_documents_entity_delete_trigger"
	AFTER UPDATE OF "deleted_at" ON "entities"
	FOR EACH ROW EXECUTE FUNCTION "search_documents_delete_entity"();--> statement-breakpoint
CREATE TRIGGER "search_documents_fact_trigger"
	AFTER INSERT OR UPDATE ON "facts"
	FOR EACH ROW EXECUTE FUNCTION "search_documents_upsert_fact"();--> statement-breakpoint
CREATE TRIGGER "search_documents_timeline_event_trigger"
	AFTER INSERT OR UPDATE ON "timeline_events"
	FOR EACH ROW EXECUTE FUNCTION "search_documents_upsert_timeline_event"();--> statement-breakpoint
CREATE TRIGGER "search_documents_map_node_trigger"
	AFTER INSERT OR UPDATE ON "map_nodes"
	FOR EACH ROW EXECUTE FUNCTION "search_documents_upsert_map_node"();--> statement-breakpoint
INSERT INTO "search_documents" (
	"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
	"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
	"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
	"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
)
SELECT
	"search_documents_uuid_v7"(), entity."work_id", entity."branch_id", entity."user_id",
	'entity', entity."id", entity."type", entity."name",
	trim(entity."summary" || ' ' || entity."description"), entity."aliases",
	version."version_node_id", version."version", NULL, 1, NULL,
	NULL, NULL, NULL, NULL, NULL, NULL,
	jsonb_build_object('status', entity."status", 'source', entity."source"),
	now(), now()
FROM "entity_versions" AS version
INNER JOIN "entities" AS entity ON entity."id" = version."entity_id"
WHERE entity."type" <> 'timeline_event' AND entity."deleted_at" IS NULL
ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "search_documents" (
	"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
	"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
	"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
	"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
)
SELECT
	"search_documents_uuid_v7"(), fact."work_id", fact."branch_id", fact."user_id",
	'fact', fact."id", NULL, fact."subject",
	trim(fact."predicate" || ' ' || fact."object"), '[]'::jsonb,
	commit."version_node_id", 1, fact."chapter_id",
	fact."valid_from_chapter", fact."valid_to_chapter",
	NULL, NULL, NULL, NULL, NULL, NULL,
	jsonb_build_object('status', fact."status", 'risk', fact."risk"),
	now(), now()
FROM "facts" AS fact
INNER JOIN "canon_commits" AS commit ON commit."id" = fact."canon_commit_id"
ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "search_documents" (
	"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
	"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
	"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
	"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
)
SELECT
	"search_documents_uuid_v7"(), event."work_id", event."branch_id", event."user_id",
	'timeline_event', event."id", 'timeline_event', entity."name", event."event_text",
	entity."aliases", event."version_node_id", 1, NULL,
	event."valid_from_chapter", event."valid_to_chapter",
	event."era", event."story_time_label", event."story_time_sort_key",
	NULL, NULL, NULL,
	jsonb_build_object(
		'status', entity."status",
		'era', event."era",
		'storyTimeSortKey', event."story_time_sort_key"
	),
	now(), now()
FROM "timeline_events" AS event
INNER JOIN "entities" AS entity ON entity."id" = event."id"
WHERE entity."deleted_at" IS NULL
ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "search_documents" (
	"id", "work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
	"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
	"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
	"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
)
SELECT
	"search_documents_uuid_v7"(), node."work_id", node."branch_id", node."user_id",
	'map_node', node."id", 'map', node."name", node."summary", '[]'::jsonb,
	node."version_node_id", 1, NULL,
	node."valid_from_chapter", node."valid_to_chapter",
	node."from_era", node."from_story_time_label", node."from_story_sort_key",
	node."to_era", node."to_story_time_label", node."to_story_sort_key",
	jsonb_build_object('nodeType', node."node_type", 'mapId', node."map_id"),
	now(), now()
FROM "map_nodes" AS node
ON CONFLICT ("branch_id", "source_type", "source_id", "version_node_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "search_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "search_documents_tenant_policy" ON "search_documents"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
