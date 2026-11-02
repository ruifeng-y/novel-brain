ALTER TABLE public.audit_logs ALTER COLUMN work_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE public.audit_logs ALTER COLUMN branch_id DROP NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.audit_logs'::regclass
      AND polname = 'audit_logs_account_tenant'
  ) THEN
    CREATE POLICY audit_logs_account_tenant ON public.audit_logs
      FOR ALL
      USING (user_id = app.current_user_id() OR app.is_auth_context())
      WITH CHECK (user_id = app.current_user_id() OR app.is_auth_context());
  END IF;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'password_resets_user_id_users_id_fk'
  ) THEN
    ALTER TABLE public.password_resets
      ADD CONSTRAINT password_resets_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users(id)
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS password_resets_token_hash_unique
  ON public.password_resets USING btree (token_hash);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS password_resets_user_created_idx
  ON public.password_resets USING btree (user_id, created_at);--> statement-breakpoint
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.password_resets FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.password_resets'::regclass
      AND polname = 'password_resets_auth_only'
  ) THEN
    CREATE POLICY password_resets_auth_only ON public.password_resets
      FOR ALL
      USING (app.is_auth_context())
      WITH CHECK (app.is_auth_context());
  END IF;
END
$$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_resets TO novel_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  new_email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_change_requests_user_id_users_id_fk'
  ) THEN
    ALTER TABLE public.email_change_requests
      ADD CONSTRAINT email_change_requests_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users(id)
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS email_change_requests_user_created_idx
  ON public.email_change_requests USING btree (user_id, created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_change_requests_email_idx
  ON public.email_change_requests USING btree (new_email);--> statement-breakpoint
ALTER TABLE public.email_change_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.email_change_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.email_change_requests'::regclass
      AND polname = 'email_change_requests_tenant'
  ) THEN
    CREATE POLICY email_change_requests_tenant ON public.email_change_requests
      FOR ALL
      USING (user_id = app.current_user_id())
      WITH CHECK (user_id = app.current_user_id());
  END IF;
END
$$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_change_requests TO novel_app;--> statement-breakpoint

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bio text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;
