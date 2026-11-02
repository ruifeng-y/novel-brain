ALTER TABLE "audit_logs" ALTER COLUMN "work_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "branch_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_logs_user_created_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_action_created_idx" ON "audit_logs" USING btree ("user_id","action","created_at");--> statement-breakpoint

CREATE POLICY audit_logs_account_tenant ON public.audit_logs
  FOR ALL
  USING (user_id = app.current_user_id() OR app.is_auth_context())
  WITH CHECK (user_id = app.current_user_id() OR app.is_auth_context());
