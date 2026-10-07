ALTER TABLE "urls" ADD COLUMN "public_id" text;--> statement-breakpoint
-- Backfill existing links. The subquery references the outer row so random()
-- is evaluated per row, not once for the whole UPDATE.
UPDATE "urls" SET "public_id" = 'link_' || (
	SELECT string_agg(substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 1 + floor(random() * 62)::int, 1), '')
	FROM generate_series(1, 24 + 0 * "urls"."id")
) WHERE "public_id" IS NULL;--> statement-breakpoint
ALTER TABLE "urls" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "urls" ADD CONSTRAINT "urls_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "urls" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "urls_organization_id_created_at_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_org_created_idx" ON "urls" USING btree ("organization_id","created_at","public_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_org_clicks_idx" ON "urls" USING btree ("organization_id","click_count","public_id");
