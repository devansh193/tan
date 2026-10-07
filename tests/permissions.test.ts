import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import { can, canManageAll } from "../src/modules/auth/permissions";
import { requirePermission, type AuthenticatedRequest } from "../src/modules/auth/auth.middleware";
import { ForbiddenError } from "../src/common/errors";

describe("permission matrix", () => {
  it.each(["owner", "admin", "member"])("%s can use links, tags and analytics", (role) => {
    for (const action of ["create", "read", "update", "delete"] as const) {
      expect(can([role], "link", action)).toBe(true);
      expect(can([role], "tag", action)).toBe(true);
    }
    expect(can([role], "analytics", "read")).toBe(true);
  });

  it("denies unknown roles and empty role lists", () => {
    expect(can(["viewer"], "link", "read")).toBe(false);
    expect(can([], "link", "read")).toBe(false);
  });

  it("grants if any of several roles allows it", () => {
    expect(can(["nobody", "member"], "link", "create")).toBe(true);
  });

  it("lets only owners and admins manage every member's links", () => {
    expect(canManageAll(["owner"])).toBe(true);
    expect(canManageAll(["admin"])).toBe(true);
    expect(canManageAll(["member"])).toBe(false);
    expect(canManageAll(["member", "admin"])).toBe(true);
  });
});

describe("requirePermission", () => {
  const run = (roles: string[] | undefined) => {
    const next = vi.fn();
    const req = { roles } as AuthenticatedRequest;
    requirePermission("link", "create")(req, {} as Response, next);
    return next;
  };

  it("calls next when allowed", () => {
    expect(run(["member"])).toHaveBeenCalledOnce();
  });

  it("throws 403 when not allowed or roles are missing", () => {
    expect(() => run(["viewer"])).toThrow(ForbiddenError);
    expect(() => run(undefined)).toThrow(ForbiddenError);
  });
});
