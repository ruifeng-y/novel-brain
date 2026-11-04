CREATE TABLE "version_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_node_id" uuid,
	"node_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"object_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"head_node_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pen_name" text NOT NULL,
	"genre" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scale_target" text DEFAULT 'long' NOT NULL,
	"chapter_length_target" integer DEFAULT 3000 NOT NULL,
	"source_mode" text NOT NULL,
	"idea" text,
	"template_key" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_branches" ADD CONSTRAINT "work_branches_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_branches" ADD CONSTRAINT "work_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "version_nodes_branch_created_idx" ON "version_nodes" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "version_nodes_user_work_idx" ON "version_nodes" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_branches_work_name_unique" ON "work_branches" USING btree ("work_id","name");--> statement-breakpoint
CREATE INDEX "work_branches_user_work_idx" ON "work_branches" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "works_user_status_updated_idx" ON "works" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "works_user_idempotency_unique" ON "works" USING btree ("user_id","idempotency_key");