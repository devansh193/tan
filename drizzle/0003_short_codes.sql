ALTER TABLE "urls" ALTER COLUMN "click_count" SET DATA TYPE bigint;--> statement-breakpoint
-- Added nullable: links without an alias get their legacy Sqids code backfilled
-- by src/db/migrate.ts, which then sets NOT NULL.
ALTER TABLE "urls" ADD COLUMN IF NOT EXISTS "code" text;--> statement-breakpoint
UPDATE "urls" SET "code" = "custom_alias" WHERE "custom_alias" IS NOT NULL AND "code" IS NULL;--> statement-breakpoint
ALTER TABLE "urls" ADD CONSTRAINT "urls_code_unique" UNIQUE("code");--> statement-breakpoint
-- Anonymize previously stored click IPs (IPv4 /24, IPv6 /48), matching what
-- the app now stores.
UPDATE "clicks" SET "ip" = CASE
	WHEN "ip" LIKE '::ffff:%.%' THEN host(network(set_masklen(substring("ip" from 8)::inet, 24)))
	WHEN position(':' in "ip") > 0 THEN host(network(set_masklen("ip"::inet, 48)))
	ELSE host(network(set_masklen("ip"::inet, 24)))
END WHERE "ip" IS NOT NULL;
