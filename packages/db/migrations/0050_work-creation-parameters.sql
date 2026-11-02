ALTER TABLE "works" ADD COLUMN "creation_mode" text DEFAULT 'blank' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "idea" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "target_reader" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "chapter_word_count" integer DEFAULT 3000 NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "update_cadence" text DEFAULT '日更' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "style_samples" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "taboos" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "synopsis" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_storage_key" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_mime_type" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_width" integer;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_height" integer;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_size" integer;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "cover_updated_at" timestamp with time zone;