import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, type Executor } from "../../db/client";
import { ConflictError } from "../../common/errors";
import { refreshTokens, users, type RefreshToken, type User } from "../../db/schema";

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Data-access layer for accounts and refresh tokens. Contains only persistence
 * concerns — no hashing, validation, or HTTP logic (that lives in the service).
 * Write methods accept an optional `Executor` so callers can run them inside a
 * transaction.
 */
export class AuthRepository {
  // --- Users ---

  findUserByEmail(email: string): Promise<User | undefined> {
    return db.query.users.findFirst({ where: eq(users.email, email) });
  }

  findUserById(id: string): Promise<User | undefined> {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  }

  /**
   * Inserts a user, relying on the unique constraint to reject duplicate
   * emails atomically (avoids a check-then-insert race) and mapping the DB
   * error to a 409.
   */
  async createUser(email: string, passwordHash: string, exec: Executor = db): Promise<User> {
    try {
      const [user] = await exec.insert(users).values({ email, passwordHash }).returning();
      return user;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError("Email already registered");
      }
      throw err;
    }
  }

  // --- Refresh tokens ---

  async createRefreshToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    exec: Executor = db,
  ): Promise<void> {
    await exec.insert(refreshTokens).values({ userId, tokenHash, expiresAt });
  }

  /** Looks up a token by hash regardless of state (used for reuse detection). */
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | undefined> {
    return db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
  }

  async revokeRefreshToken(id: string, exec: Executor = db): Promise<void> {
    await exec.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id));
  }

  /** Revokes every active token for a user (logout-all / theft response). */
  async revokeAllForUser(userId: string, exec: Executor = db): Promise<void> {
    await exec
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /** Deletes spent tokens (expired or revoked); returns the row count removed. */
  async deleteSpentTokens(): Promise<number> {
    const deleted = await db
      .delete(refreshTokens)
      .where(or(lt(refreshTokens.expiresAt, new Date()), isNotNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return deleted.length;
  }
}

export const authRepository = new AuthRepository();
