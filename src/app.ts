import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./common/logger";
import { pool } from "./db/client";
import { asyncHandler } from "./common/asyncHandler";
import { authRoutes } from "./modules/auth/auth.routes";
import { urlRoutes } from "./modules/url/url.routes";
import { urlController } from "./modules/url/url.controller";
import { errorHandler, notFoundHandler } from "./common/middleware/errorHandler";

/** Consistent 429 body matching our error envelope. */
const rateLimitHandler = (_req: express.Request, res: express.Response) =>
  res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });

/** Builds the Express application with middleware and routes wired up. */
export const createApp = () => {
  const app = express();

  // Trust the first proxy hop so `req.ip` and rate limiting see real client IPs.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    }),
  );
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: "16kb" }));

  // Global rate limit, with a stricter cap on auth endpoints.
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rateLimitHandler,
    }),
  );
  const authLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
  });

  // Liveness (process up) and readiness (dependencies reachable) probes.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ status: "ready" });
    }),
  );

  // API routes.
  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/urls", urlRoutes);

  // Public redirect: GET /:code -> original URL. Kept last so it never
  // shadows the API/health routes above.
  app.get("/:code", urlController.redirect);

  // 404 + central error handling, registered after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
