import { db, type Executor } from "../../db/client";
import { UnauthorizedError } from "../../common/errors";
import { logger } from "../../common/logger";
import { AuthRepository, authRepository } from "./auth.repository";
import { hashPassword, verifyPassword } from "./password";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "./token";

/** Tokens returned to the client after register/login/refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Business logic for authentication: credential checks, password hashing, and
 * issuing/rotating tokens. Delegates all persistence to AuthRepository.
 */
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  /** Creates an account and returns a fresh token pair. */
  async register(email: string, password: string): Promise<AuthTokens> {
    const passwordHash = await hashPassword(password);
    // The unique constraint (handled in the repo) guards against duplicates.
    return db.transaction(async (tx) => {
      const user = await this.repo.createUser(email, passwordHash, tx);
      return this.issueTokens(user.id, tx);
    });
  }

  /** Verifies credentials and returns a fresh token pair. */
  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.repo.findUserByEmail(email);
    // Verify even when the user is missing to keep timing uniform, then fail.
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedError("Invalid credentials");

    return this.issueTokens(user.id);
  }

  /**
   * Rotates a refresh token: validates it, revokes it, and issues a new pair.
   * Presenting an already-revoked token is treated as reuse (theft) and revokes
   * every active token for that user.
   */
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const stored = await this.repo.findRefreshTokenByHash(tokenHash);

    if (!stored) throw new UnauthorizedError("Invalid refresh token");

    if (stored.revokedAt) {
      await this.repo.revokeAllForUser(stored.userId);
      logger.warn({ userId: stored.userId }, "Refresh token reuse detected — revoked all sessions");
      throw new UnauthorizedError("Refresh token reuse detected");
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError("Expired refresh token");
    }

    // Revoke the old token and mint a new pair atomically.
    return db.transaction(async (tx) => {
      await this.repo.revokeRefreshToken(stored.id, tx);
      return this.issueTokens(stored.userId, tx);
    });
  }

  /** Revokes a single refresh token (sign out of the current session). */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const stored = await this.repo.findRefreshTokenByHash(tokenHash);
    if (stored && !stored.revokedAt) await this.repo.revokeRefreshToken(stored.id);
  }

  /** Revokes every active token for a user (sign out everywhere). */
  async logoutAll(userId: string): Promise<void> {
    await this.repo.revokeAllForUser(userId);
  }

  /** Mints an access JWT plus a persisted refresh token for a user. */
  private async issueTokens(userId: string, exec?: Executor): Promise<AuthTokens> {
    const accessToken = signAccessToken(userId);
    const { raw, tokenHash, expiresAt } = generateRefreshToken();
    await this.repo.createRefreshToken(userId, tokenHash, expiresAt, exec);
    return { accessToken, refreshToken: raw };
  }
}

export const authService = new AuthService(authRepository);
