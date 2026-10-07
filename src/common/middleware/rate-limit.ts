import type express from "express";
import rateLimit, { type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../../lib/redis";

/** Consistent 429 body matching our error envelope. */
const rateLimitHandler = (_req: express.Request, res: express.Response) =>
  res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });

/**
 * RedisStore loads its Lua scripts in the constructor; if Redis isn't up yet
 * that promise rejects unobserved. The store reloads scripts on first use, so
 * those early failures are safe to ignore.
 */
class LazyRedisStore extends RedisStore {
  constructor(...args: ConstructorParameters<typeof RedisStore>) {
    super(...args);
    this.incrementScriptSha.catch(() => {});
    this.getScriptSha.catch(() => {});
  }
}

/**
 * A rate limiter whose counters live in Redis when configured, so the limit is
 * shared by every instance. Fails open if Redis is unreachable.
 */
export const limiter = (prefix: string, windowMs: number, max: number) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    passOnStoreError: true,
    ...(redis && {
      store: new LazyRedisStore({
        prefix: `rl:${prefix}:`,
        sendCommand: (...args: string[]) => redis!.sendCommand(args),
      }) as Options["store"],
    }),
  });
