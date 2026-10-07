import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Every resource/action an organization role can be granted. Better Auth's own
 * statements (organization, member, invitation, …) are kept so its endpoints
 * keep authorizing as before.
 */
const statements = {
  ...defaultStatements,
  link: ["create", "read", "update", "delete"],
  tag: ["create", "read", "update", "delete"],
  analytics: ["read"],
} as const;

export const ac = createAccessControl(statements);

const appAccess = {
  link: ["create", "read", "update", "delete"],
  tag: ["create", "read", "update", "delete"],
  analytics: ["read"],
} as const;

/**
 * Organization roles. Members hold link update/delete, but only for links they
 * created; the service enforces ownership via `canManageAll`.
 */
export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, ...appAccess }),
  admin: ac.newRole({ ...adminAc.statements, ...appAccess }),
  member: ac.newRole({ ...memberAc.statements, ...appAccess }),
};

export type Resource = keyof typeof appAccess;
export type Action<R extends Resource> = (typeof appAccess)[R][number];

type AnyRole = { authorize: (request: Record<string, string[]>) => { success: boolean } };

/** True if any of the member's roles grants `action` on `resource`. */
export const can = <R extends Resource>(
  memberRoles: string[],
  resource: R,
  action: Action<R>,
): boolean =>
  memberRoles.some(
    (name) =>
      (roles as Record<string, AnyRole | undefined>)[name]?.authorize({ [resource]: [action] })
        .success ?? false,
  );

/** Owners and admins manage every member's links; others only their own. */
export const canManageAll = (memberRoles: string[]): boolean =>
  memberRoles.includes("owner") || memberRoles.includes("admin");
