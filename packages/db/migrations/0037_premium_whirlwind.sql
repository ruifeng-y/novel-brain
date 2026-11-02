CREATE TABLE "account_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_audit_logs" ADD CONSTRAINT "account_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_audit_logs_user_created_idx" ON "account_audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "account_audit_logs_user_action_created_idx" ON "account_audit_logs" USING btree ("user_id","action","created_at");--> statement-breakpoint
CREATE INDEX "account_audit_logs_search_trgm_idx" ON "account_audit_logs" USING gin ((("title" || ' ' || "detail")) gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE public.account_audit_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.account_audit_logs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY account_audit_logs_tenant_or_auth ON public.account_audit_logs
  FOR ALL
  USING (user_id = app.current_user_id() OR app.is_auth_context())
  WITH CHECK (user_id = app.current_user_id() OR app.is_auth_context());--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_audit_logs TO novel_app;--> statement-breakpoint

CREATE TRIGGER account_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.account_audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_history();
