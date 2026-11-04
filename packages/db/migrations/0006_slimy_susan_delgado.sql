ALTER TABLE "audit_logs" ADD COLUMN "ip" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_configs" ADD COLUMN "purposes" jsonb DEFAULT '["writing"]'::jsonb NOT NULL;