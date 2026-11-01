CREATE TYPE "public"."model_purpose" AS ENUM('planning', 'prose', 'check');--> statement-breakpoint
CREATE TABLE "model_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'deepseek' NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"model" text NOT NULL,
	"purpose" "model_purpose" DEFAULT 'prose' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_configs_user_updated_idx" ON "model_configs" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_configs_user_purpose_unique" ON "model_configs" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "model_configs_one_default_unique" ON "model_configs" USING btree ("user_id") WHERE "model_configs"."is_default" = true;