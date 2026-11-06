CREATE TABLE "character_itineraries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"departure_era" text NOT NULL,
	"departure_label" text NOT NULL,
	"departure_sort_key" integer NOT NULL,
	"arrival_era" text NOT NULL,
	"arrival_label" text NOT NULL,
	"arrival_sort_key" integer NOT NULL,
	"route_travel_minutes" integer NOT NULL,
	"travel_minutes" integer NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"source_chapter_id" uuid,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_itineraries_time_check" CHECK ("character_itineraries"."arrival_era" <> "character_itineraries"."departure_era" or "character_itineraries"."arrival_sort_key" > "character_itineraries"."departure_sort_key"),
	CONSTRAINT "character_itineraries_travel_check" CHECK ("character_itineraries"."travel_minutes" >= "character_itineraries"."route_travel_minutes"),
	CONSTRAINT "character_itineraries_validity_check" CHECK ("character_itineraries"."valid_to_chapter" is null or "character_itineraries"."valid_to_chapter" >= "character_itineraries"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "faction_profiles" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"resources" text DEFAULT '' NOT NULL,
	"doctrine" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faction_relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_faction_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_label" text,
	"relation_type" text NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"source_chapter_id" uuid,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faction_relationships_target_type_check" CHECK ("faction_relationships"."target_type" = 'faction'),
	CONSTRAINT "faction_relationships_relation_type_check" CHECK ("faction_relationships"."relation_type" in ('ally', 'enemy', 'vassal', 'overlord', 'trade', 'neutral')),
	CONSTRAINT "faction_relationships_validity_check" CHECK ("faction_relationships"."valid_to_chapter" is null or "faction_relationships"."valid_to_chapter" >= "faction_relationships"."valid_from_chapter"),
	CONSTRAINT "faction_relationships_from_story_time_check" CHECK (("faction_relationships"."from_era" is null and "faction_relationships"."from_story_time_label" is null and "faction_relationships"."from_story_sort_key" is null) or ("faction_relationships"."from_era" is not null and "faction_relationships"."from_story_time_label" is not null and "faction_relationships"."from_story_sort_key" is not null)),
	CONSTRAINT "faction_relationships_to_story_time_check" CHECK (("faction_relationships"."to_era" is null and "faction_relationships"."to_story_time_label" is null and "faction_relationships"."to_story_sort_key" is null) or ("faction_relationships"."from_era" is not null and "faction_relationships"."to_era" is not null and "faction_relationships"."to_story_time_label" is not null and "faction_relationships"."to_story_sort_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "map_control" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"faction_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"node_type" text NOT NULL,
	"node_id" uuid NOT NULL,
	"node_label" text,
	"control_level" text NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_control_node_type_check" CHECK ("map_control"."node_type" in ('map', 'map_node')),
	CONSTRAINT "map_control_level_check" CHECK ("map_control"."control_level" in ('direct', 'military', 'influence', 'contested')),
	CONSTRAINT "map_control_validity_check" CHECK ("map_control"."valid_to_chapter" is null or "map_control"."valid_to_chapter" >= "map_control"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "map_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"layer_id" uuid,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"route_type" text NOT NULL,
	"bidirectional" boolean DEFAULT true NOT NULL,
	"travel_minutes" integer NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_edges_type_check" CHECK ("map_edges"."route_type" in ('road', 'trail', 'water', 'air', 'teleport', 'secret')),
	CONSTRAINT "map_edges_endpoint_check" CHECK ("map_edges"."from_node_id" <> "map_edges"."to_node_id"),
	CONSTRAINT "map_edges_travel_time_check" CHECK ("map_edges"."travel_minutes" > 0),
	CONSTRAINT "map_edges_validity_check" CHECK ("map_edges"."valid_to_chapter" is null or "map_edges"."valid_to_chapter" >= "map_edges"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "map_layers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_layer_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"min_scale" real DEFAULT 0 NOT NULL,
	"max_scale" real DEFAULT 100 NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_layers_scale_check" CHECK ("map_layers"."max_scale" >= "map_layers"."min_scale"),
	CONSTRAINT "map_layers_validity_check" CHECK ("map_layers"."valid_to_chapter" is null or "map_layers"."valid_to_chapter" >= "map_layers"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "map_markers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"layer_id" uuid,
	"node_id" uuid,
	"label" text NOT NULL,
	"marker_type" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_markers_type_check" CHECK ("map_markers"."marker_type" in ('danger', 'event', 'resource', 'note', 'character')),
	CONSTRAINT "map_markers_coordinates_check" CHECK ("map_markers"."x" >= 0 and "map_markers"."x" <= 1 and "map_markers"."y" >= 0 and "map_markers"."y" <= 1),
	CONSTRAINT "map_markers_validity_check" CHECK ("map_markers"."valid_to_chapter" is null or "map_markers"."valid_to_chapter" >= "map_markers"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "map_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"layer_id" uuid,
	"parent_node_id" uuid,
	"name" text NOT NULL,
	"node_type" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"x" real,
	"y" real,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_nodes_type_check" CHECK ("map_nodes"."node_type" in ('region', 'settlement', 'landmark', 'passage', 'battlefield', 'sect', 'dungeon', 'other')),
	CONSTRAINT "map_nodes_coordinates_check" CHECK (("map_nodes"."x" is null and "map_nodes"."y" is null) or ("map_nodes"."x" >= 0 and "map_nodes"."x" <= 1 and "map_nodes"."y" >= 0 and "map_nodes"."y" <= 1)),
	CONSTRAINT "map_nodes_validity_check" CHECK ("map_nodes"."valid_to_chapter" is null or "map_nodes"."valid_to_chapter" >= "map_nodes"."valid_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "timeline_eras" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order_index" integer NOT NULL,
	"start_sort_key" integer NOT NULL,
	"end_sort_key" integer,
	"description" text DEFAULT '' NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeline_eras_range_check" CHECK ("timeline_eras"."end_sort_key" is null or "timeline_eras"."end_sort_key" >= "timeline_eras"."start_sort_key")
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"era" text NOT NULL,
	"story_time_label" text NOT NULL,
	"story_time_sort_key" integer NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"duration_label" text DEFAULT '' NOT NULL,
	"event_text" text NOT NULL,
	"valid_from_chapter" integer NOT NULL,
	"valid_to_chapter" integer,
	"from_era" text,
	"from_story_time_label" text,
	"from_story_sort_key" integer,
	"to_era" text,
	"to_story_time_label" text,
	"to_story_sort_key" integer,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeline_events_duration_check" CHECK ("timeline_events"."duration_minutes" >= 0),
	CONSTRAINT "timeline_events_validity_check" CHECK ("timeline_events"."valid_to_chapter" is null or "timeline_events"."valid_to_chapter" >= "timeline_events"."valid_from_chapter")
);
--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_from_node_id_map_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_to_node_id_map_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_itineraries" ADD CONSTRAINT "character_itineraries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_profiles" ADD CONSTRAINT "faction_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_profiles" ADD CONSTRAINT "faction_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_profiles" ADD CONSTRAINT "faction_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_profiles" ADD CONSTRAINT "faction_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_relationships" ADD CONSTRAINT "faction_relationships_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_relationships" ADD CONSTRAINT "faction_relationships_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_relationships" ADD CONSTRAINT "faction_relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_relationships" ADD CONSTRAINT "faction_relationships_source_faction_id_entities_id_fk" FOREIGN KEY ("source_faction_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_relationships" ADD CONSTRAINT "faction_relationships_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_relationships" ADD CONSTRAINT "faction_relationships_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_relationships" ADD CONSTRAINT "faction_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_control" ADD CONSTRAINT "map_control_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_control" ADD CONSTRAINT "map_control_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_control" ADD CONSTRAINT "map_control_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_control" ADD CONSTRAINT "map_control_faction_id_entities_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_control" ADD CONSTRAINT "map_control_map_id_entities_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_control" ADD CONSTRAINT "map_control_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_control" ADD CONSTRAINT "map_control_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_map_id_entities_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_layer_id_map_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."map_layers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_from_node_id_map_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_to_node_id_map_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_map_id_entities_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_parent_layer_id_map_layers_id_fk" FOREIGN KEY ("parent_layer_id") REFERENCES "public"."map_layers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_map_id_entities_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_layer_id_map_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."map_layers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_node_id_map_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."map_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_map_id_entities_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_layer_id_map_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."map_layers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_parent_node_id_map_nodes_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_eras" ADD CONSTRAINT "timeline_eras_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_id_entities_id_fk" FOREIGN KEY ("id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_itineraries_character_time_idx" ON "character_itineraries" USING btree ("character_id","departure_sort_key");--> statement-breakpoint
CREATE INDEX "character_itineraries_user_work_idx" ON "character_itineraries" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "faction_profiles_user_work_idx" ON "faction_profiles" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "faction_profiles_branch_idx" ON "faction_profiles" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "faction_relationships_source_valid_idx" ON "faction_relationships" USING btree ("source_faction_id","valid_from_chapter");--> statement-breakpoint
CREATE INDEX "faction_relationships_user_work_idx" ON "faction_relationships" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "map_control_node_valid_idx" ON "map_control" USING btree ("node_id","valid_from_chapter");--> statement-breakpoint
CREATE INDEX "map_control_user_work_idx" ON "map_control" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "map_edges_map_from_idx" ON "map_edges" USING btree ("map_id","from_node_id");--> statement-breakpoint
CREATE INDEX "map_edges_user_work_idx" ON "map_edges" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_layers_map_name_unique" ON "map_layers" USING btree ("map_id","name");--> statement-breakpoint
CREATE INDEX "map_layers_user_work_idx" ON "map_layers" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "map_markers_map_idx" ON "map_markers" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "map_markers_user_work_idx" ON "map_markers" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_nodes_map_name_unique" ON "map_nodes" USING btree ("map_id","name");--> statement-breakpoint
CREATE INDEX "map_nodes_map_parent_idx" ON "map_nodes" USING btree ("map_id","parent_node_id");--> statement-breakpoint
CREATE INDEX "map_nodes_user_work_idx" ON "map_nodes" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_eras_branch_name_unique" ON "timeline_eras" USING btree ("branch_id","name");--> statement-breakpoint
CREATE INDEX "timeline_eras_user_work_idx" ON "timeline_eras" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_events_branch_slot_unique" ON "timeline_events" USING btree ("branch_id","era","story_time_sort_key");--> statement-breakpoint
CREATE INDEX "timeline_events_user_work_idx" ON "timeline_events" USING btree ("user_id","work_id");--> statement-breakpoint
INSERT INTO "faction_profiles" ("entity_id", "work_id", "branch_id", "user_id", "created_at", "updated_at")
SELECT "id", "work_id", "branch_id", "user_id", "created_at", "updated_at"
FROM "entities"
WHERE "type" = 'faction'
ON CONFLICT ("entity_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "timeline_events"
	("id", "work_id", "branch_id", "user_id", "era", "story_time_label", "story_time_sort_key",
	 "duration_minutes", "duration_label", "event_text", "valid_from_chapter", "version_node_id",
	 "created_by", "created_at")
SELECT
	"entity"."id",
	"entity"."work_id",
	"entity"."branch_id",
	"entity"."user_id",
	COALESCE(NULLIF("entity"."attributes"->>'era', ''), '未分纪元'),
	COALESCE(NULLIF("entity"."attributes"->>'storyTime', ''), '未记录'),
	(ROW_NUMBER() OVER (
		PARTITION BY "entity"."branch_id", COALESCE(NULLIF("entity"."attributes"->>'era', ''), '未分纪元')
		ORDER BY "entity"."created_at", "entity"."id"
	) - 1)::integer * 100,
	0,
	COALESCE(NULLIF("entity"."attributes"->>'duration', ''), ''),
	COALESCE(NULLIF("entity"."attributes"->>'event', ''), "entity"."summary"),
	1,
	COALESCE(
		(SELECT "entity_version"."version_node_id"
		   FROM "entity_versions" AS "entity_version"
		  WHERE "entity_version"."entity_id" = "entity"."id"
		  ORDER BY "entity_version"."version" DESC
		  LIMIT 1),
		(SELECT "branch"."head_node_id" FROM "work_branches" AS "branch" WHERE "branch"."id" = "entity"."branch_id")
	),
	"entity"."user_id",
	"entity"."created_at"
FROM "entities" AS "entity"
WHERE "entity"."type" = 'timeline_event'
	AND COALESCE(
		(SELECT "entity_version"."version_node_id"
		   FROM "entity_versions" AS "entity_version"
		  WHERE "entity_version"."entity_id" = "entity"."id"
		  ORDER BY "entity_version"."version" DESC
		  LIMIT 1),
		(SELECT "branch"."head_node_id" FROM "work_branches" AS "branch" WHERE "branch"."id" = "entity"."branch_id")
	) IS NOT NULL
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "faction_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "faction_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "faction_profiles_tenant_policy" ON "faction_profiles"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "faction_relationships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "faction_relationships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "faction_relationships_tenant_policy" ON "faction_relationships"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "map_control" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "map_control" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "map_control_tenant_policy" ON "map_control"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "map_layers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "map_layers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "map_layers_tenant_policy" ON "map_layers"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "map_nodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "map_nodes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "map_nodes_tenant_policy" ON "map_nodes"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "map_edges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "map_edges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "map_edges_tenant_policy" ON "map_edges"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "map_markers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "map_markers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "map_markers_tenant_policy" ON "map_markers"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "timeline_eras" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeline_eras" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "timeline_eras_tenant_policy" ON "timeline_eras"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "timeline_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeline_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "timeline_events_tenant_policy" ON "timeline_events"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "character_itineraries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "character_itineraries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "character_itineraries_tenant_policy" ON "character_itineraries"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
