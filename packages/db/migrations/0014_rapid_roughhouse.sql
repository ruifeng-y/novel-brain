ALTER TABLE "story_bibles" ADD COLUMN "cards" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD CONSTRAINT "story_bibles_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;