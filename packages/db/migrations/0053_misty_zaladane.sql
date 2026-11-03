ALTER TABLE "entity_custom_fields" ADD COLUMN "applicable_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_custom_fields" ADD COLUMN "required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_custom_fields" ADD COLUMN "relation_target_type" text;--> statement-breakpoint
ALTER TABLE "entity_custom_fields" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;