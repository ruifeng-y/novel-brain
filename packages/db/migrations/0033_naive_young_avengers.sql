CREATE TABLE "character_arcs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"responsible_role" text NOT NULL,
	"source_chapter_id" uuid,
	"source_event_id" uuid,
	"target_from_chapter" integer NOT NULL,
	"target_to_chapter" integer NOT NULL,
	"prerequisite_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"character_id" uuid NOT NULL,
	"start_state" text NOT NULL,
	"desire" text NOT NULL,
	"fear" text NOT NULL,
	"lie" text NOT NULL,
	"truth" text NOT NULL,
	"end_state" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"version_node_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_arcs_status_check" CHECK ("character_arcs"."status" in ('planned', 'planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned', 'deferred')),
	CONSTRAINT "character_arcs_responsible_role_check" CHECK ("character_arcs"."responsible_role" in ('protagonist', 'antagonist', 'supporting', 'ensemble', 'author')),
	CONSTRAINT "character_arcs_source_check" CHECK (("character_arcs"."status" not in ('planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned') or "character_arcs"."source_chapter_id" is not null or "character_arcs"."source_event_id" is not null)),
	CONSTRAINT "character_arcs_history_check" CHECK (("character_arcs"."status" = 'planned' or jsonb_array_length("character_arcs"."history") > 0)),
	CONSTRAINT "character_arcs_evidence_check" CHECK (("character_arcs"."status" not in ('paid_off', 'failed_payoff') or jsonb_array_length("character_arcs"."evidence") > 0)),
	CONSTRAINT "character_arcs_target_window_check" CHECK ("character_arcs"."target_to_chapter" >= "character_arcs"."target_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "foreshadows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"responsible_role" text NOT NULL,
	"source_chapter_id" uuid,
	"source_event_id" uuid,
	"target_from_chapter" integer NOT NULL,
	"target_to_chapter" integer NOT NULL,
	"prerequisite_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"importance" text DEFAULT 'must' NOT NULL,
	"reader_promise" text NOT NULL,
	"related_character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_faction_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"version_node_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foreshadows_importance_check" CHECK ("foreshadows"."importance" in ('must', 'optional')),
	CONSTRAINT "foreshadows_status_check" CHECK ("foreshadows"."status" in ('planned', 'planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned', 'deferred')),
	CONSTRAINT "foreshadows_responsible_role_check" CHECK ("foreshadows"."responsible_role" in ('protagonist', 'antagonist', 'supporting', 'ensemble', 'author')),
	CONSTRAINT "foreshadows_source_check" CHECK (("foreshadows"."status" not in ('planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned') or "foreshadows"."source_chapter_id" is not null or "foreshadows"."source_event_id" is not null)),
	CONSTRAINT "foreshadows_history_check" CHECK (("foreshadows"."status" = 'planned' or jsonb_array_length("foreshadows"."history") > 0)),
	CONSTRAINT "foreshadows_evidence_check" CHECK (("foreshadows"."status" not in ('paid_off', 'failed_payoff') or jsonb_array_length("foreshadows"."evidence") > 0)),
	CONSTRAINT "foreshadows_target_window_check" CHECK ("foreshadows"."target_to_chapter" >= "foreshadows"."target_from_chapter")
);
--> statement-breakpoint
CREATE TABLE "plot_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"responsible_role" text NOT NULL,
	"source_chapter_id" uuid,
	"source_event_id" uuid,
	"target_from_chapter" integer NOT NULL,
	"target_to_chapter" integer NOT NULL,
	"prerequisite_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thread_type" text NOT NULL,
	"stakes" text NOT NULL,
	"tension" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"version_node_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plot_threads_thread_type_check" CHECK ("plot_threads"."thread_type" in ('main', 'subplot', 'character', 'faction', 'world', 'mystery', 'romance')),
	CONSTRAINT "plot_threads_status_check" CHECK ("plot_threads"."status" in ('planned', 'planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned', 'deferred')),
	CONSTRAINT "plot_threads_responsible_role_check" CHECK ("plot_threads"."responsible_role" in ('protagonist', 'antagonist', 'supporting', 'ensemble', 'author')),
	CONSTRAINT "plot_threads_source_check" CHECK (("plot_threads"."status" not in ('planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned') or "plot_threads"."source_chapter_id" is not null or "plot_threads"."source_event_id" is not null)),
	CONSTRAINT "plot_threads_history_check" CHECK (("plot_threads"."status" = 'planned' or jsonb_array_length("plot_threads"."history") > 0)),
	CONSTRAINT "plot_threads_evidence_check" CHECK (("plot_threads"."status" not in ('paid_off', 'failed_payoff') or jsonb_array_length("plot_threads"."evidence") > 0)),
	CONSTRAINT "plot_threads_target_window_check" CHECK ("plot_threads"."target_to_chapter" >= "plot_threads"."target_from_chapter"),
	CONSTRAINT "plot_threads_tension_check" CHECK ("plot_threads"."tension" is null or ("plot_threads"."tension" >= 0 and "plot_threads"."tension" <= 100))
);
--> statement-breakpoint
ALTER TABLE "version_nodes" DROP CONSTRAINT "version_nodes_node_type_check";--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_source_event_id_timeline_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_character_id_entities_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arcs" ADD CONSTRAINT "character_arcs_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_source_event_id_timeline_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_source_event_id_timeline_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_arcs_user_work_idx" ON "character_arcs" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "character_arcs_branch_status_idx" ON "character_arcs" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "character_arcs_branch_target_idx" ON "character_arcs" USING btree ("branch_id","target_to_chapter");--> statement-breakpoint
CREATE INDEX "character_arcs_character_idx" ON "character_arcs" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "foreshadows_user_work_idx" ON "foreshadows" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "foreshadows_branch_status_idx" ON "foreshadows" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "foreshadows_branch_target_idx" ON "foreshadows" USING btree ("branch_id","target_to_chapter");--> statement-breakpoint
CREATE INDEX "plot_threads_user_work_idx" ON "plot_threads" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "plot_threads_branch_status_idx" ON "plot_threads" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "plot_threads_branch_target_idx" ON "plot_threads" USING btree ("branch_id","target_to_chapter");--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_node_type_check" CHECK ("version_nodes"."node_type" in ('chapter_version', 'outline_version', 'ledger_version', 'story_bible_version', 'entity_version', 'canon_commit', 'snapshot', 'change_apply', 'branch_merge', 'rollback'));--> statement-breakpoint
ALTER TABLE "plot_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plot_threads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plot_threads_tenant_policy" ON "plot_threads"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "foreshadows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "foreshadows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "foreshadows_tenant_policy" ON "foreshadows"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "character_arcs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "character_arcs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "character_arcs_tenant_policy" ON "character_arcs"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
