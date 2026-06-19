import { z } from "zod";

/**
 * Registration / login share the same credential shape.
 * - email is trimmed + lowercased so casing never creates duplicate accounts.
 * - password is capped at 72 bytes because bcrypt silently ignores anything
 *   beyond that, which would otherwise make long passwords interchangeable.
 */
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "must be at least 8 characters").max(72),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
