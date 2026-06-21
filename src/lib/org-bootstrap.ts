import { generateId } from "better-auth";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { member, organization } from "../db/auth-schema";
import { logger } from "../common/logger";

/**
 * Multitenancy bootstrap helpers used by Better Auth's database hooks.
 *
 * Every user gets a personal organization on sign-up so the org-scoped URL
 * routes always have a tenant to act within. On session creation we resolve the
 * user's first membership and pin it as the active organization.
 */

/** A URL/DNS-safe slug fragment derived from a display name. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "org"
  );
}

/**
 * Creates a personal organization for a brand-new user and adds them as owner.
 * The slug is suffixed with a short random token to stay globally unique.
 */
export async function createPersonalOrganization(
  userId: string,
  name: string,
): Promise<string> {
  const orgId = generateId();
  const slug = `${slugify(name)}-${generateId().slice(0, 8)}`;

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: orgId,
      name: `${name}'s Organization`,
      slug,
    });
    await tx.insert(member).values({
      id: generateId(),
      organizationId: orgId,
      userId,
      role: "owner",
    });
  });

  return orgId;
}

/** Returns the user's earliest organization membership, or null if none. */
export async function getFirstOrganizationId(userId: string): Promise<string | null> {
  const row = await db.query.member.findFirst({
    where: eq(member.userId, userId),
    orderBy: asc(member.createdAt),
    columns: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

/** Confirms a user belongs to an organization (tenant authorization). */
export async function isMember(userId: string, organizationId: string): Promise<boolean> {
  const row = await db.query.member.findFirst({
    where: (m, { and: andOp }) =>
      andOp(eq(m.userId, userId), eq(m.organizationId, organizationId)),
    columns: { id: true },
  });
  return Boolean(row);
}

/** Best-effort personal-org creation that never blocks sign-up. */
export async function ensurePersonalOrganization(
  userId: string,
  name: string,
): Promise<void> {
  try {
    await createPersonalOrganization(userId, name);
  } catch (err) {
    logger.error({ err, userId }, "Failed to create personal organization");
  }
}
