import { createApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";
import { logger } from "./common/logger";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`URL shortener listening on ${env.BASE_URL} (port ${env.PORT})`);
});

// Better Auth manages session/token lifecycle and expiry internally, so no
// background token-cleanup job is needed here.

/** Closes the HTTP server and DB pool so the process exits cleanly. */
const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
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
