ALTER TABLE "search_documents" DROP CONSTRAINT "search_documents_pkey";--> statement-breakpoint
DROP INDEX "search_documents_source_version_unique";--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_pkey" PRIMARY KEY("branch_id","source_type","source_id","version_node_id");--> statement-breakpoint
ALTER TABLE "search_documents" DROP COLUMN "id";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_documents_upsert_entity"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "search_documents" (
		"work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		entity."work_id", entity."branch_id", entity."user_id",
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
CREATE OR REPLACE FUNCTION "search_documents_upsert_fact"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "search_documents" (
		"work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		fact."work_id", fact."branch_id", fact."user_id",
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
		"work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		event."work_id", event."branch_id", event."user_id",
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
		"work_id", "branch_id", "user_id", "source_type", "source_id", "entity_type",
		"title", "content", "aliases", "version_node_id", "object_version", "source_chapter_id",
		"from_chapter", "to_chapter", "from_era", "from_story_time_label", "from_story_sort_key",
		"to_era", "to_story_time_label", "to_story_sort_key", "metadata", "created_at", "updated_at"
	)
	SELECT
		node."work_id", node."branch_id", node."user_id",
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
DROP FUNCTION "search_documents_uuid_v7"();
