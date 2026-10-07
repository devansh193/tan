ALTER TABLE "urls" DROP CONSTRAINT "urls_custom_alias_unique";--> statement-breakpoint
ALTER TABLE "urls" DROP COLUMN IF EXISTS "custom_alias";