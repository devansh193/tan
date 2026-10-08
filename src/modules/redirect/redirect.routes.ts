import { Router, type NextFunction, type Request, type Response } from "express";
import { limiter } from "../../common/middleware/rate-limit";
import { env } from "../../config/env";
import { redirectController } from "./redirect.controller";

/** Short links are never search results; preview bots may still fetch them. */
const noindex = (_req: Request, res: Response, next: NextFunction) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
};

/**
 * Public routes. robots.txt blocks only the API so link-preview bots can follow
 * short links (and see noindex). GET /:code[/:channel] has its own, much higher
 * per-minute limit. Mount last so it never shadows API/health routes.
 */
export const redirectRoutes = Router();

redirectRoutes.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /api/\n");
});

redirectRoutes.get(
  "/:code/:channel?",
  noindex,
  limiter("redirect", 60_000, env.REDIRECT_RATE_LIMIT_MAX),
  redirectController.redirect,
);
