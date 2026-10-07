import "dotenv/config";
import { z } from "zod";

/**
 * Validates and exposes environment variables.
 * Fails fast at startup if anything required is missing or malformed,
 * so the rest of the app can rely on `env` being correct and typed.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  // Base URL used to build the full short link returned to clients.
  BASE_URL: z.string().url().default("http://localhost:3000"),
  // Comma-separated allowlist of CORS origins, or "*" to allow all.
  CORS_ORIGINS: z.string().default("*"),
  // Express "trust proxy": hop count ("1"), "true"/"false", or a subnet list
  // ("loopback, 10.0.0.0/8"). Must match your proxy chain or req.ip is wrong.
  TRUST_PROXY: z
    .string()
    .default("1")
    .transform((v) =>
      /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v,
    ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),

  // Better Auth: signing/encryption secret (32+ chars) and public base URL.
  // Generate a secret with: openssl rand -base64 32
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  // Email (Resend). Required in production for verification + password reset.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // Rate limiting (window + max requests per window).
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  // Public redirects, per IP per minute. Generous: offices share one NAT IP.
  REDIRECT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  // Shared rate-limit store across instances. Without it, limits are per process.
  REDIS_URL: z.string().url().optional(),

  // Google Safe Browsing v4 key; when set, flagged URLs can't be shortened.
  SAFE_BROWSING_API_KEY: z.string().optional(),

  // Delete click analytics older than this many days. Unset = keep forever.
  CLICK_RETENTION_DAYS: z.coerce.number().int().positive().optional(),

  // Legacy only: used to backfill codes of links created before random codes.
  SQIDS_MIN_LENGTH: z.coerce.number().int().min(0).default(6),
  SQIDS_ALPHABET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === "production") {
  const missing: string[] = [];
  if (!env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");
  if (missing.length) {
    console.error(`Missing required production env: ${missing.join(", ")}`);
    process.exit(1);
  }
}

export { env };
