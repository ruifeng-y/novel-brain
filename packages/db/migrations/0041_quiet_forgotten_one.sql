CREATE TABLE "pen_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "pen_name_id" uuid;--> statement-breakpoint
ALTER TABLE "pen_names" ADD CONSTRAINT "pen_names_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pen_names_user_name_unique" ON "pen_names" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pen_names_one_default_unique" ON "pen_names" USING btree ("user_id") WHERE "pen_names"."is_default" = true;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_pen_name_id_pen_names_id_fk" FOREIGN KEY ("pen_name_id") REFERENCES "public"."pen_names"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

INSERT INTO public.pen_names (user_id, name, is_default)
SELECT id, display_name, true
FROM public.users
WHERE display_name <> ''
ON CONFLICT (user_id, name) DO NOTHING;--> statement-breakpoint

INSERT INTO public.pen_names (user_id, name, is_default)
SELECT DISTINCT user_id, pen_name, false
FROM public.works
WHERE pen_name <> ''
ON CONFLICT (user_id, name) DO NOTHING;--> statement-breakpoint

UPDATE public.works
SET pen_name_id = pen_names.id
FROM public.pen_names
WHERE pen_names.user_id = works.user_id
  AND pen_names.name = works.pen_name
  AND works.pen_name_id IS NULL;--> statement-breakpoint

ALTER TABLE public.pen_names ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.pen_names FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pen_names_tenant ON public.pen_names
  FOR ALL
  USING (user_id = app.current_user_id() OR app.is_auth_context())
  WITH CHECK (user_id = app.current_user_id() OR app.is_auth_context());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pen_names TO novel_app;
