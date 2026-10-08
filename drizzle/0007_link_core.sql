CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "urls" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "urls" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "urls" ADD COLUMN "redirect_type" smallint DEFAULT 302 NOT NULL;--> statement-breakpoint
ALTER TABLE "urls" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing links were last changed when they were created.
UPDATE "urls" SET "updated_at" = "created_at";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_org_user_created_idx" ON "urls" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_code_trgm_idx" ON "urls" USING gin ("code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_title_trgm_idx" ON "urls" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_original_url_trgm_idx" ON "urls" USING gin ("original_url" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "urls" ADD CONSTRAINT "urls_redirect_type_check" CHECK ("urls"."redirect_type" IN (301, 302));