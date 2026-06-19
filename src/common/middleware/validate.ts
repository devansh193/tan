import type { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { BadRequestError } from "../errors";

/** Formats the first Zod issue into a readable "path: message" string. */
const firstIssue = (error: { issues: { path: (string | number)[]; message: string }[] }) => {
  const issue = error.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
};

/**
 * Validates `req.body` against a Zod schema. On success the parsed (and typed)
 * value replaces `req.body`; on failure a 400 with the first issue is thrown.
 */
export const validateBody =
  (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) throw new BadRequestError(firstIssue(result.error));
    req.body = result.data;
    next();
  };

/**
 * Validates `req.query` against a Zod schema. The parsed result is stored on
 * `res.locals.query` because Express's `req.query` can be read-only.
 */
export const validateQuery =
  (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) throw new BadRequestError(firstIssue(result.error));
    res.locals.query = result.data;
    next();
  };
