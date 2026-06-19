import { createApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";
import { logger } from "./common/logger";
import { authRepository } from "./modules/auth/auth.repository";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`URL shortener listening on ${env.BASE_URL} (port ${env.PORT})`);
});

// Periodically purge expired/revoked refresh tokens so the table stays small.
const cleanupInterval = setInterval(
  () => {
    authRepository
      .deleteSpentTokens()
      .then((removed) => removed && logger.info({ removed }, "Purged spent refresh tokens"))
      .catch((err) => logger.error({ err }, "Token cleanup failed"));
  },
  env.TOKEN_CLEANUP_INTERVAL_MIN * 60 * 1000,
);
// Don't keep the event loop alive solely for the timer.
cleanupInterval.unref();

/** Closes the timer, HTTP server and DB pool so the process exits cleanly. */
const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  clearInterval(cleanupInterval);
  server.close(() => {
    pool
      .end()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
  // Force-exit if graceful shutdown stalls.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
