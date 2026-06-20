ALTER TABLE "clicks" DROP COLUMN IF EXISTS "referrer";--> statement-breakpoint
ALTER TABLE "clicks" DROP COLUMN IF EXISTS "user_agent";--> statement-breakpoint
ALTER TABLE "clicks" DROP COLUMN IF EXISTS "ip_hash";--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "ip" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "country" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "state" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "city" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "browser" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "os" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "device" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "referer" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "utm_source" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "utm_medium" text;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "utm_campaign" text;
