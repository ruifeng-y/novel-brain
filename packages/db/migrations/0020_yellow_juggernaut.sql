CREATE TYPE "public"."map_level" AS ENUM('world', 'realm', 'continent', 'region', 'city', 'location');--> statement-breakpoint
CREATE TABLE "character_presences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"character_entity_id" uuid NOT NULL,
	"location_node_id" uuid NOT NULL,
	"story_time" text NOT NULL,
	"source" text DEFAULT '作者录入' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"travel_minutes" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"x_percent" real NOT NULL,
	"y_percent" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"parent_node_id" uuid,
	"level" "map_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_presences" ADD CONSTRAINT "character_presences_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_presences" ADD CONSTRAINT "character_presences_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_presences" ADD CONSTRAINT "character_presences_character_entity_id_entities_id_fk" FOREIGN KEY ("character_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_presences" ADD CONSTRAINT "character_presences_location_node_id_map_nodes_id_fk" FOREIGN KEY ("location_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_connections" ADD CONSTRAINT "map_connections_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_connections" ADD CONSTRAINT "map_connections_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_connections" ADD CONSTRAINT "map_connections_from_node_id_map_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_connections" ADD CONSTRAINT "map_connections_to_node_id_map_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_images" ADD CONSTRAINT "map_images_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_images" ADD CONSTRAINT "map_images_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_images" ADD CONSTRAINT "map_images_node_id_map_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_images" ADD CONSTRAINT "map_images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_image_id_map_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."map_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_node_id_map_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_parent_node_id_map_nodes_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_presences_branch_character_location_time_unique" ON "character_presences" USING btree ("work_id","branch_id","character_entity_id","location_node_id","story_time");--> statement-breakpoint
CREATE INDEX "character_presences_branch_character_time_idx" ON "character_presences" USING btree ("work_id","branch_id","character_entity_id","story_time");--> statement-breakpoint
CREATE UNIQUE INDEX "map_connections_work_branch_pair_unique" ON "map_connections" USING btree ("work_id","branch_id","from_node_id","to_node_id");--> statement-breakpoint
CREATE INDEX "map_connections_work_branch_idx" ON "map_connections" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_images_node_unique" ON "map_images" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "map_images_work_branch_idx" ON "map_images" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_markers_image_node_unique" ON "map_markers" USING btree ("image_id","node_id");--> statement-breakpoint
CREATE INDEX "map_markers_work_branch_idx" ON "map_markers" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_nodes_entity_unique" ON "map_nodes" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_nodes_one_world_per_branch" ON "map_nodes" USING btree ("work_id","branch_id") WHERE "map_nodes"."level" = 'world';--> statement-breakpoint
CREATE INDEX "map_nodes_work_branch_level_idx" ON "map_nodes" USING btree ("work_id","branch_id","level");--> statement-breakpoint
CREATE INDEX "map_nodes_parent_idx" ON "map_nodes" USING btree ("parent_node_id");