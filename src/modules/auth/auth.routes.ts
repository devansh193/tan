import { Router } from "express";
import { validateBody } from "../../common/middleware/validate";
import { authController } from "./auth.controller";
import { credentialsSchema, refreshSchema } from "./auth.schema";
import { requireAuth } from "./auth.middleware";

export const authRoutes = Router();

authRoutes.post("/register", validateBody(credentialsSchema), authController.register);
authRoutes.post("/login", validateBody(credentialsSchema), authController.login);
authRoutes.post("/refresh", validateBody(refreshSchema), authController.refresh);
authRoutes.post("/logout", validateBody(refreshSchema), authController.logout);
authRoutes.post("/logout-all", requireAuth, authController.logoutAll);
