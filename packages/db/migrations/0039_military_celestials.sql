CREATE TABLE "email_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"new_email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_change_requests_user_created_idx" ON "email_change_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_change_requests_email_idx" ON "email_change_requests" USING btree ("new_email");--> statement-breakpoint

ALTER TABLE public.email_change_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.email_change_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY email_change_requests_tenant ON public.email_change_requests
  FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_change_requests TO novel_app;
