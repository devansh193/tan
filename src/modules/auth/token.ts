import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../common/errors";

/** Claims embedded in the access JWT. */
export interface AccessTokenPayload {
  sub: string; // user id
}

/** Signs a short-lived access JWT for the given user. */
export const signAccessToken = (userId: string): string =>
  jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  } as jwt.SignOptions);

/** Verifies an access JWT, returning its payload or throwing 401. */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    // Guard against unexpected token shapes before trusting the subject.
    if (typeof decoded === "string" || typeof decoded.sub !== "string") {
      throw new Error("malformed payload");
    }
    return { sub: decoded.sub };
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
};

/**
 * Generates an opaque refresh token. The raw value is returned to the client
 * once; only its SHA-256 hash is persisted, so the DB never holds a usable
 * token. The matching expiry is derived from configuration.
 */
export const generateRefreshToken = () => {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, tokenHash, expiresAt };
};

/** Hashes a refresh token for storage/lookup. */
export const hashRefreshToken = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");
