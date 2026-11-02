CREATE TABLE "account_purge_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"status" text NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deletion_scheduled_for" timestamp with time zone,
	"purged_at" timestamp with time zone NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_purge_receipts_user_unique" ON "account_purge_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_purge_receipts_purged_idx" ON "account_purge_receipts" USING btree ("purged_at");--> statement-breakpoint

ALTER TABLE public.account_purge_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.account_purge_receipts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.account_purge_receipts FROM novel_app;
