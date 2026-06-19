import { describe, it, expect } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from "../src/modules/auth/token";
import { UnauthorizedError } from "../src/common/errors";

describe("access tokens", () => {
  it("signs and verifies, preserving the subject", () => {
    const token = signAccessToken("user-123");
    expect(verifyAccessToken(token).sub).toBe("user-123");
  });

  it("rejects a tampered token", () => {
    const token = signAccessToken("user-123");
    expect(() => verifyAccessToken(token + "x")).toThrow(UnauthorizedError);
  });
});

describe("refresh tokens", () => {
  it("returns a raw value whose hash matches the stored hash", () => {
    const { raw, tokenHash, expiresAt } = generateRefreshToken();
    expect(hashRefreshToken(raw)).toBe(tokenHash);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
