ALTER TABLE "chapters" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "hook" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "autosave_content" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "autosave_updated_at" timestamp with time zone;