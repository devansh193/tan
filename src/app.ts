import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { pinoHttp } from "pino-http";
import { toNodeHandler } from "better-auth/node";
import { env } from "./config/env";
import { logger } from "./common/logger";
import { pool } from "./db/client";
import { auth } from "./lib/auth";
import { redis } from "./lib/redis";
import { asyncHandler } from "./common/asyncHandler";
import { urlRoutes } from "./modules/url/url.routes";
import { urlController } from "./modules/url/url.controller";
import { errorHandler, notFoundHandler } from "./common/middleware/errorHandler";

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
const limiter = (prefix: string, windowMs: number, max: number) =>
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

/** Builds the Express application with middleware and routes wired up. */
export const createApp = () => {
  const app = express();

  // Must match the real proxy chain so `req.ip` (rate limits, geo) is correct.
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    }),
  );
  app.use(pinoHttp({ logger }));

  // Better Auth owns every /api/auth/* route (sign-up/in, sign-out, and the
  // jwt plugin's /token + /jwks). Its node handler reads the RAW request body,
  // so it MUST be mounted before express.json(). A stricter limiter guards it.
  const authLimiter = limiter("auth", env.RATE_LIMIT_WINDOW_MS, env.AUTH_RATE_LIMIT_MAX);
  // toNodeHandler returns a promise-returning handler; Express ignores the
  // returned promise, so wrap it to satisfy the void-return expectation.
  const authHandler = toNodeHandler(auth);
  app.all("/api/auth/*", authLimiter, (req, res) => void authHandler(req, res));

  // JSON parsing for the rest of the app (after the auth handler).
  app.use(express.json({ limit: "16kb" }));

  // Liveness (process up) and readiness (dependencies reachable) probes.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ status: "ready" });
    }),
  );

  // API routes (management traffic: strict limit).
  app.use("/api/urls", limiter("api", env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX), urlRoutes);

  // Public redirect: GET /:code[/:channel] -> original URL. Own, much higher per-minute
  // limit (blunts code scanning without throttling real visitors). Kept last so
  // it never shadows the API/health routes above.
  app.get(
    "/:code/:channel?",
    limiter("redirect", 60_000, env.REDIRECT_RATE_LIMIT_MAX),
    urlController.redirect,
  );

  // 404 + central error handling, registered after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
