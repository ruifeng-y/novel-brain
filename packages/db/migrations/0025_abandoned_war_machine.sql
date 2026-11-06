CREATE TABLE "pen_names" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pen_names" ADD CONSTRAINT "pen_names_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pen_names_user_name_unique" ON "pen_names" USING btree ("user_id","name") WHERE "pen_names"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pen_names_user_default_unique" ON "pen_names" USING btree ("user_id") WHERE "pen_names"."is_default" and "pen_names"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "pen_names_user_updated_idx" ON "pen_names" USING btree ("user_id","updated_at");