import { createClient } from "redis";
import { env } from "../config/env";
import { logger } from "../common/logger";

/** Shared Redis client, or null when REDIS_URL is unset (single-instance mode). */
// No offline queue: while Redis is down commands fail fast (callers fail open)
// instead of piling up in memory and hanging requests.
export const redis = env.REDIS_URL
  ? createClient({ url: env.REDIS_URL, disableOfflineQueue: true })
  : null;

if (redis) {
  redis.on("error", (err) => logger.error({ err }, "Redis error"));
  redis.connect().catch((err) => logger.error({ err }, "Redis connect failed"));
}
