CREATE TABLE "character_state_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"reason" text NOT NULL,
	"source" text DEFAULT '作者录入' NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"power" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"possessions" text DEFAULT '' NOT NULL,
	"disguise" text DEFAULT '' NOT NULL,
	"knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_state_revisions" ADD CONSTRAINT "character_state_revisions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_revisions" ADD CONSTRAINT "character_state_revisions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_revisions" ADD CONSTRAINT "character_state_revisions_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state_revisions" ADD CONSTRAINT "character_state_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_states" ADD CONSTRAINT "character_states_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_states" ADD CONSTRAINT "character_states_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_states" ADD CONSTRAINT "character_states_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_states" ADD CONSTRAINT "character_states_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_state_revisions_character_version_unique" ON "character_state_revisions" USING btree ("character_id","version");--> statement-breakpoint
CREATE INDEX "character_state_revisions_character_created_idx" ON "character_state_revisions" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "character_states_character_unique" ON "character_states" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "character_states_work_branch_idx" ON "character_states" USING btree ("work_id","branch_id");