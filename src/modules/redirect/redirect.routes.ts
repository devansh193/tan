import { Router } from "express";
import { limiter } from "../../common/middleware/rate-limit";
import { env } from "../../config/env";
import { redirectController } from "./redirect.controller";

/**
 * Public redirect: GET /:code[/:channel]. Own, much higher per-minute limit
 * (blunts code scanning without throttling real visitors). Mount last so it
 * never shadows API/health routes.
 */
export const redirectRoutes = Router();

redirectRoutes.get(
  "/:code/:channel?",
  limiter("redirect", 60_000, env.REDIRECT_RATE_LIMIT_MAX),
  redirectController.redirect,
);
