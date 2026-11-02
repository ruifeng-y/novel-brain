-- A separate, non-owner login keeps row-level security in force for the API
-- and worker. Migration and operational commands continue to use the owner
-- connection from DATABASE_ADMIN_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novel_app') THEN
    CREATE ROLE novel_app
      LOGIN
      PASSWORD 'novel_app'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO novel_app', current_database());
END
$$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app, public TO novel_app;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.is_auth_context()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.auth', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION app.owns_work(target_work_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.works
    WHERE id = target_work_id
      AND user_id = app.current_user_id()
  )
$$;

CREATE OR REPLACE FUNCTION app.owns_chapter(target_chapter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chapters
    WHERE id = target_chapter_id
      AND app.owns_work(work_id)
  )
$$;

CREATE OR REPLACE FUNCTION app.owns_generation_request(target_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.generation_requests
    WHERE id = target_request_id
      AND app.owns_work(work_id)
  )
$$;

CREATE OR REPLACE FUNCTION app.owns_job(target_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs
    WHERE id = target_job_id
      AND user_id = app.current_user_id()
  )
$$;

CREATE OR REPLACE FUNCTION app.owns_change_request(target_change_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.change_requests
    WHERE id = target_change_request_id
      AND app.owns_work(work_id)
  )
$$;

-- Authentication reads users, sessions, and email codes before a tenant is
-- known. That access is limited to a transaction marked by the auth service.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_or_auth ON public.users
  FOR ALL
  USING (id = app.current_user_id() OR app.is_auth_context())
  WITH CHECK (id = app.current_user_id() OR app.is_auth_context());

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant_or_auth ON public.sessions
  FOR ALL
  USING (user_id = app.current_user_id() OR app.is_auth_context())
  WITH CHECK (user_id = app.current_user_id() OR app.is_auth_context());

ALTER TABLE public.email_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY email_codes_auth_only ON public.email_codes
  FOR ALL
  USING (app.is_auth_context())
  WITH CHECK (app.is_auth_context());

ALTER TABLE public.model_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY model_configs_tenant ON public.model_configs
  FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.works FORCE ROW LEVEL SECURITY;
CREATE POLICY works_tenant ON public.works
  FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE public.story_bible_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_bible_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY story_bible_revisions_tenant ON public.story_bible_revisions
  FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE public.character_state_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_state_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY character_state_revisions_tenant ON public.character_state_revisions
  FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_tenant ON public.jobs
  FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE public.work_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY work_branches_tenant ON public.work_branches
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.story_bibles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_bibles FORCE ROW LEVEL SECURITY;
CREATE POLICY story_bibles_tenant ON public.story_bibles
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.foreshadows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foreshadows FORCE ROW LEVEL SECURITY;
CREATE POLICY foreshadows_tenant ON public.foreshadows
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threads FORCE ROW LEVEL SECURITY;
CREATE POLICY threads_tenant ON public.threads
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.character_arcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_arcs FORCE ROW LEVEL SECURITY;
CREATE POLICY character_arcs_tenant ON public.character_arcs
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.chapter_outlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_outlines FORCE ROW LEVEL SECURITY;
CREATE POLICY chapter_outlines_tenant ON public.chapter_outlines
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.entity_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_custom_fields FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_custom_fields_tenant ON public.entity_custom_fields
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities FORCE ROW LEVEL SECURITY;
CREATE POLICY entities_tenant ON public.entities
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.character_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY character_profiles_tenant ON public.character_profiles
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.character_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_states FORCE ROW LEVEL SECURITY;
CREATE POLICY character_states_tenant ON public.character_states
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.entity_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_relations_tenant ON public.entity_relations
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.power_system_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.power_system_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY power_system_profiles_tenant ON public.power_system_profiles
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.golden_fingers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golden_fingers FORCE ROW LEVEL SECURITY;
CREATE POLICY golden_fingers_tenant ON public.golden_fingers
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.item_technique_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_technique_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY item_technique_profiles_tenant ON public.item_technique_profiles
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.item_ownerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_ownerships FORCE ROW LEVEL SECURITY;
CREATE POLICY item_ownerships_tenant ON public.item_ownerships
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.timeline_eras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_eras FORCE ROW LEVEL SECURITY;
CREATE POLICY timeline_eras_tenant ON public.timeline_eras
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.timeline_event_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_event_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY timeline_event_nodes_tenant ON public.timeline_event_nodes
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters FORCE ROW LEVEL SECURITY;
CREATE POLICY chapters_tenant ON public.chapters
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.chapter_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY chapter_versions_tenant ON public.chapter_versions
  FOR ALL
  USING (app.owns_chapter(chapter_id))
  WITH CHECK (app.owns_chapter(chapter_id));

ALTER TABLE public.generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_requests_tenant ON public.generation_requests
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.context_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_packs FORCE ROW LEVEL SECURITY;
CREATE POLICY context_packs_tenant ON public.context_packs
  FOR ALL
  USING (app.owns_generation_request(generation_request_id))
  WITH CHECK (app.owns_generation_request(generation_request_id));

ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY drafts_tenant ON public.drafts
  FOR ALL
  USING (app.owns_generation_request(generation_request_id))
  WITH CHECK (app.owns_generation_request(generation_request_id));

ALTER TABLE public.fact_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fact_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_proposals_tenant ON public.fact_proposals
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facts FORCE ROW LEVEL SECURITY;
CREATE POLICY facts_tenant ON public.facts
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotations FORCE ROW LEVEL SECURITY;
CREATE POLICY annotations_tenant ON public.annotations
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.quality_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_reports_tenant ON public.quality_reports
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.canon_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canon_commits FORCE ROW LEVEL SECURITY;
CREATE POLICY canon_commits_tenant ON public.canon_commits
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.canon_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canon_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY canon_snapshots_tenant ON public.canon_snapshots
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.job_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY job_steps_tenant ON public.job_steps
  FOR ALL
  USING (app.owns_job(job_id))
  WITH CHECK (app.owns_job(job_id));

ALTER TABLE public.job_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY job_checkpoints_tenant ON public.job_checkpoints
  FOR ALL
  USING (app.owns_job(job_id))
  WITH CHECK (app.owns_job(job_id));

ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_events FORCE ROW LEVEL SECURITY;
CREATE POLICY job_events_tenant ON public.job_events
  FOR ALL
  USING (app.owns_job(job_id))
  WITH CHECK (app.owns_job(job_id));

ALTER TABLE public.job_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_chapters FORCE ROW LEVEL SECURITY;
CREATE POLICY job_chapters_tenant ON public.job_chapters
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.job_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY job_reports_tenant ON public.job_reports
  FOR ALL
  USING (app.owns_job(job_id))
  WITH CHECK (app.owns_job(job_id));

ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY change_requests_tenant ON public.change_requests
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.change_impact_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_impact_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY change_impact_reports_tenant ON public.change_impact_reports
  FOR ALL
  USING (app.owns_change_request(change_request_id))
  WITH CHECK (app.owns_change_request(change_request_id));

ALTER TABLE public.change_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_validations FORCE ROW LEVEL SECURITY;
CREATE POLICY change_validations_tenant ON public.change_validations
  FOR ALL
  USING (app.owns_change_request(change_request_id))
  WITH CHECK (app.owns_change_request(change_request_id));

ALTER TABLE public.map_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY map_nodes_tenant ON public.map_nodes
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.map_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY map_connections_tenant ON public.map_connections
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.map_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_images FORCE ROW LEVEL SECURITY;
CREATE POLICY map_images_tenant ON public.map_images
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.map_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_markers FORCE ROW LEVEL SECURITY;
CREATE POLICY map_markers_tenant ON public.map_markers
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

ALTER TABLE public.character_presences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_presences FORCE ROW LEVEL SECURITY;
CREATE POLICY character_presences_tenant ON public.character_presences
  FOR ALL
  USING (app.owns_work(work_id))
  WITH CHECK (app.owns_work(work_id));

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO novel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO novel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO novel_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO novel_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO novel_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO novel_app;
