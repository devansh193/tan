import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../src/modules/auth/auth.service";
import { hashPassword } from "../src/modules/auth/password";
import { UnauthorizedError } from "../src/common/errors";
import type { User } from "../src/db/schema";

const makeRepo = () => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  createUser: vi.fn(),
  createRefreshToken: vi.fn().mockResolvedValue(undefined),
  findRefreshTokenByHash: vi.fn(),
  revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
  revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  deleteSpentTokens: vi.fn(),
});

let repo: ReturnType<typeof makeRepo>;
let service: AuthService;

beforeEach(() => {
  repo = makeRepo();
  service = new AuthService(repo);
});

describe("login", () => {
  it("issues a token pair for valid credentials", async () => {
    const user = { id: "user-1", passwordHash: await hashPassword("password123") } as User;
    repo.findUserByEmail.mockResolvedValue(user);

    const tokens = await service.login("a@b.com", "password123");
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
  });

  it("rejects an unknown email", async () => {
    repo.findUserByEmail.mockResolvedValue(undefined);
    await expect(service.login("a@b.com", "password123")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a wrong password", async () => {
    const user = { id: "user-1", passwordHash: await hashPassword("password123") } as User;
    repo.findUserByEmail.mockResolvedValue(user);
    await expect(service.login("a@b.com", "wrong-password")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe("refresh", () => {
  it("rejects an unknown token", async () => {
    repo.findRefreshTokenByHash.mockResolvedValue(undefined);
    await expect(service.refresh("raw")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("detects reuse and revokes all sessions", async () => {
    repo.findRefreshTokenByHash.mockResolvedValue({
      id: "t1",
      userId: "user-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    });

    await expect(service.refresh("raw")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(repo.revokeAllForUser).toHaveBeenCalledWith("user-1");
  });

  it("rejects an expired token", async () => {
    repo.findRefreshTokenByHash.mockResolvedValue({
      id: "t1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.refresh("raw")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("logout", () => {
  it("revokes an active token", async () => {
    repo.findRefreshTokenByHash.mockResolvedValue({
      id: "t1",
      userId: "user-1",
      revokedAt: null,
    });
    await service.logout("raw");
    expect(repo.revokeRefreshToken).toHaveBeenCalledWith("t1");
  });
});

describe("logoutAll", () => {
  it("revokes every token for the user", async () => {
    await service.logoutAll("user-1");
    expect(repo.revokeAllForUser).toHaveBeenCalledWith("user-1");
  });
});
