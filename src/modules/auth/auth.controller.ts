import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { authService } from "./auth.service";
import type { AuthenticatedRequest } from "./auth.middleware";

/** HTTP layer for auth: parses requests, calls the service, shapes responses. */
export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const tokens = await authService.register(email, password);
    res.status(201).json(tokens);
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const tokens = await authService.login(email, password);
    res.json(tokens);
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const tokens = await authService.refresh(req.body.refreshToken);
    res.json(tokens);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(req.body.refreshToken);
    res.status(204).send();
  }),

  // Requires a valid access token; revokes every refresh token for the user.
  logoutAll: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await authService.logoutAll(req.userId!);
    res.status(204).send();
  }),
};
