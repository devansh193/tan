import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, jwt, organization } from "better-auth/plugins";
import { db } from "../db/client";
import { env } from "../config/env";
import { sendEmail } from "./email";
import { ensurePersonalOrganization, getFirstOrganizationId } from "./org-bootstrap";
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
 * - `organization()` provides multitenancy: organizations (tenants), members
 *   with roles, and email invitations, mounted under `/api/auth/organization/*`.
 *
 * Multitenancy bootstrap (see `databaseHooks` below): every new user gets a
 * personal organization, and each new session is pinned to the user's first
 * organization so the org-scoped URL routes always have an active tenant.
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

  // Multitenancy bootstrap. Keep these side effects out of the request path:
  // create a personal org once per user, and resolve the active org per session.
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          await ensurePersonalOrganization(createdUser.id, createdUser.name);
        },
      },
    },
    session: {
      create: {
        before: async (newSession) => {
          const activeOrganizationId = await getFirstOrganizationId(newSession.userId);
          return { data: { ...newSession, activeOrganizationId } };
        },
      },
    },
  },

  plugins: [
    bearer(),
    jwt(),
    organization({
      // Pending invites expire after 48 hours.
      invitationExpiresIn: 60 * 60 * 48,
      sendInvitationEmail: async ({ id, email, organization: org, inviter }) => {
        const url = `${env.BASE_URL}/accept-invitation/${id}`;
        await sendEmail({
          to: email,
          subject: `You've been invited to join ${org.name}`,
          text:
            `${inviter.user.name} (${inviter.user.email}) invited you to join ` +
            `"${org.name}".\n\nAccept the invitation:\n\n${url}\n\n` +
            `If you weren't expecting this, you can ignore this email.`,
        });
      },
    }),
  ],
});

/** Inferred session/user types for use across the app. */
export type Session = typeof auth.$Infer.Session;
