import { createApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";
import { logger } from "./common/logger";
import { redis } from "./lib/redis";
import { analyticsRepository } from "./modules/analytics/analytics.repository";
import { clickRecorder } from "./modules/analytics/click-recorder";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`URL shortener listening on ${env.BASE_URL} (port ${env.PORT})`);
});

// Better Auth manages session/token lifecycle and expiry internally, so no
// background token-cleanup job is needed here.

// Click analytics retention. Idempotent, so every instance may run it.
if (env.CLICK_RETENTION_DAYS) {
  const days = env.CLICK_RETENTION_DAYS;
  const sweep = () =>
    analyticsRepository
      .deleteClicksBefore(new Date(Date.now() - days * 86_400_000))
      .then((n) => n && logger.info({ deleted: n }, "Pruned old click analytics"))
      .catch((err) => logger.error({ err }, "Click retention sweep failed"));
  void sweep();
  setInterval(() => void sweep(), 6 * 60 * 60 * 1000).unref();
}

/** Closes the HTTP server, drains buffered clicks, and closes connections. */
const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  server.close(() => {
    clickRecorder
      .stop()
      .then(() => Promise.all([pool.end(), redis?.quit()]))
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
  // Force-exit if graceful shutdown stalls.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
