import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors";
import { logger } from "../logger";

/** Catch-all 404 for unmatched routes. */
export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

/** Narrows an unknown error to one carrying a client (4xx) HTTP status. */
const clientStatus = (err: unknown): number | undefined => {
  if (err && typeof err === "object" && "statusCode" in err) {
    const status = err.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) return status;
  }
  return undefined;
};

/**
 * Central error handler. `AppError`s map to their status + code; body-parser
 * style errors (e.g. malformed JSON) map to their 4xx status; anything else is
 * an unexpected 500 and is logged for investigation.
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // `next` is required for Express to recognise this as an error handler.
  _next: NextFunction,
) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  const status = clientStatus(err);
  if (status) {
    const code = status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST";
    res.status(status).json({ error: { code, message: "Malformed or invalid request" } });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
};
