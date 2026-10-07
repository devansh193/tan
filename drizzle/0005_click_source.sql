ALTER TABLE "clicks" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN "source_method" text;--> statement-breakpoint
-- Backfill attribution for existing clicks from what was stored (UTM, in-app
-- browser name, referrer), strongest signal first. Mirrors detectSource().
UPDATE "clicks" SET "source_method" = 'utm', "source" = CASE lower(trim("utm_source"))
	WHEN 'ig' THEN 'instagram' WHEN 'insta' THEN 'instagram'
	WHEN 'fb' THEN 'facebook' WHEN 'meta' THEN 'facebook'
	WHEN 'li' THEN 'linkedin' WHEN 'lnkd' THEN 'linkedin'
	WHEN 'twitter' THEN 'x' WHEN 'x.com' THEN 'x'
	WHEN 'tt' THEN 'tiktok' WHEN 'yt' THEN 'youtube'
	WHEN 'mail' THEN 'email' WHEN 'newsletter' THEN 'email'
	ELSE left(lower(trim("utm_source")), 64) END
WHERE "source" IS NULL AND "utm_source" IS NOT NULL;--> statement-breakpoint
UPDATE "clicks" SET "source_method" = 'ua', "source" = lower(split_part("browser", ' ', 1))
WHERE "source" IS NULL AND split_part("browser", ' ', 1) IN ('Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'Snapchat', 'Pinterest');--> statement-breakpoint
WITH m(domain, source) AS (VALUES
	('t.co', 'x'), ('x.com', 'x'), ('twitter.com', 'x'),
	('instagram.com', 'instagram'), ('threads.net', 'threads'),
	('facebook.com', 'facebook'), ('fb.com', 'facebook'),
	('linkedin.com', 'linkedin'), ('lnkd.in', 'linkedin'),
	('youtube.com', 'youtube'), ('youtu.be', 'youtube'), ('reddit.com', 'reddit'),
	('tiktok.com', 'tiktok'), ('pinterest.com', 'pinterest'), ('snapchat.com', 'snapchat'),
	('t.me', 'telegram'), ('web.whatsapp.com', 'whatsapp'),
	('mail.google.com', 'email'), ('outlook.live.com', 'email'),
	('google.com', 'google'), ('bing.com', 'bing'), ('duckduckgo.com', 'duckduckgo')
), hosts AS (
	SELECT "id", lower(substring("referer" from '^https?://([^/:?#]+)')) AS host
	FROM "clicks" WHERE "source" IS NULL AND "referer" IS NOT NULL
), hits AS (
	-- Most specific domain wins (mail.google.com over google.com).
	SELECT DISTINCT ON (h."id") h."id", m.source
	FROM hosts h JOIN m ON h.host = m.domain OR h.host LIKE '%.' || m.domain
	ORDER BY h."id", length(m.domain) DESC
)
UPDATE "clicks" c SET "source" = hits.source, "source_method" = 'referer'
FROM hits WHERE c."id" = hits."id";--> statement-breakpoint
UPDATE "clicks" SET "source" = 'unknown', "source_method" = 'none' WHERE "source" IS NULL;
