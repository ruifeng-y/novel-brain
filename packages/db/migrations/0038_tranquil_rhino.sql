CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_hash_unique" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_created_idx" ON "password_resets" USING btree ("user_id","created_at");--> statement-breakpoint

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.password_resets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY password_resets_auth_only ON public.password_resets
  FOR ALL
  USING (app.is_auth_context())
  WITH CHECK (app.is_auth_context());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_resets TO novel_app;
