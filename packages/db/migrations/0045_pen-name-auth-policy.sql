DROP POLICY IF EXISTS pen_names_tenant ON public.pen_names;--> statement-breakpoint
CREATE POLICY pen_names_tenant ON public.pen_names
  FOR ALL
  USING (user_id = app.current_user_id() OR app.is_auth_context())
  WITH CHECK (user_id = app.current_user_id() OR app.is_auth_context());
