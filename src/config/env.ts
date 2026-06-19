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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(1),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  JWT_ISSUER: z.string().default("url-shortener"),
  JWT_AUDIENCE: z.string().default("url-shortener-clients"),

  // Rate limiting (window + max requests per window).
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  // How often to purge expired/revoked refresh tokens (minutes).
  TOKEN_CLEANUP_INTERVAL_MIN: z.coerce.number().int().positive().default(60),

  SQIDS_MIN_LENGTH: z.coerce.number().int().min(0).default(6),
  SQIDS_ALPHABET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
