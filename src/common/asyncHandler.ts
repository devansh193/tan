import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async controller so that any rejected promise is forwarded to
 * Express's error handler instead of crashing the process. Lets controllers
 * use plain `async/await` without repetitive try/catch blocks.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);
