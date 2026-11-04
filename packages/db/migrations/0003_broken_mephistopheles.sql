CREATE TABLE "model_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_masked" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_test_status" text,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_configs_user_id_idx" ON "model_configs" USING btree ("user_id");