import pino from "pino";
import { env } from "../config/env";

/**
 * Process-wide structured logger. Pretty-prints in development, emits JSON in
 * production (better for log aggregation), and stays quiet during tests.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { translateTime: "SYS:standard", ignore: "pid,hostname" },
        }
      : undefined,
});
