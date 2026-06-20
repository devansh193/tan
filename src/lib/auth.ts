import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, jwt } from "better-auth/plugins";
import { db } from "../db/client";
import { env } from "../config/env";
import { sendEmail } from "./email";
import * as authSchema from "../db/auth-schema";

const requireEmailVerification = env.NODE_ENV === "production";

/**
 * Better Auth instance — the single source of truth for authentication.
 *
 * - Drizzle/Postgres adapter persists the user/session/account/verification
 *   (and `jwks`, from the jwt plugin) tables defined in `db/auth-schema.ts`.
 * - `emailAndPassword` enables credential sign-up/sign-in.
 * - `bearer()` lets API clients authenticate with `Authorization: Bearer <token>`
 *   instead of cookies — the session token is returned in the `set-auth-token`
 *   response header on sign-in/sign-up.
 * - `jwt()` exposes `GET /api/auth/token` (a verifiable EdDSA JWT) and
 *   `GET /api/auth/jwks` so other services can validate tokens statelessly.
 *
 * Endpoints are mounted at `/api/auth/*` (see `app.ts`).
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  basePath: "/api/auth",
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),

  // CORS "*" can't be a trusted origin; the baseURL is trusted automatically.
  trustedOrigins:
    env.CORS_ORIGINS === "*" ? undefined : env.CORS_ORIGINS.split(",").map((o) => o.trim()),

  emailAndPassword: {
    enabled: true,
    // Mirrors the previous policy: min 8, capped at 72 bytes.
    minPasswordLength: 8,
    maxPasswordLength: 72,
    requireEmailVerification,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Click the link to reset your password:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: requireEmailVerification,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email address",
        text: `Click the link to verify your email:\n\n${url}`,
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh every 24h
  },

  // Better Auth's own per-endpoint limiter (sign-in/sign-up are stricter).
  // Enabled in production; the Express limiter in app.ts covers dev.
  rateLimit: {
    enabled: env.NODE_ENV === "production",
  },

  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
  },

  plugins: [bearer(), jwt()],
});

/** Inferred session/user types for use across the app. */
export type Session = typeof auth.$Infer.Session;
