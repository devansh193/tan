# Phase A — v1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/api/urls` with a versioned, resource-grouped `/api/v1/links` API. Links are addressed by immutable public IDs, listed with keyset (cursor) pagination, and guarded by a role → permission check. The `url` module is split into `links/`, `analytics/` and `redirect/`.

**Architecture:**
- **Express routing:** the router `src/routes/v1.ts` mounts resource groups behind `requireAuth`, `requireOrganization`, then a per-route `requirePermission`.
- **Links:** `links/` owns link CRUD.
- **Analytics:** `analytics/` owns click capture (attribution, recorder, click repository).
- **Redirects:** `redirect/` owns the public `/:code` path.
- **Permissions:** Better Auth's organization plugin gets a custom access control (`ac` and `roles`). The same role objects authorize API requests locally, with no extra DB call.

**Tech Stack:** Bun, TypeScript, Express 4, Drizzle ORM (Postgres 16), Better Auth 1.6 (organization plugin), Zod, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-10-08-link-platform-v1-design.md` (§2, §3, §4, §11-A)

## Global Constraints

- Base path `/api/v1`. Auth is unchanged: `Authorization: Bearer <session token>`.
- Error envelope `{ error: { code, message } }`, unchanged (`src/common/errors.ts`).
- Link public ID: `link_` + 24 base62 chars (CSPRNG). The internal `bigserial` id never appears in a response or cursor.
- Pagination: `?limit=1..100` (default 20) `&cursor=`. Response `{ data, nextCursor }`, no `total`.
- Keyset order: `(created_at, public_id)` or `(click_count, public_id)`. `urls.created_at` is `timestamptz(3)`.
- Status codes:
  - Create: `201` + `Location`.
  - Read: `200`.
  - Delete: `204`.
  - Errors: validation `400`, unauthenticated `401`, role `403`, missing or other org `404`, code taken `409`.
- Permissions:
  - owner, admin and member all have `link.create|read|update|delete`, `tag.*` and `analytics.read`.
  - A member may update or delete only links they created; the service enforces this.
  - No `viewer` role yet (phase F).
- `/api/urls` is removed entirely.
- Code style: match the surrounding code. Doc comment on each export, `asyncHandler` controllers, classes for repositories/services with a singleton export, Prettier (`bun run format`).
- Run everything with `bun run …`. Unit tests need no DB. DB tests run with `RUN_DB_TESTS=1` against `docker compose up -d` (Postgres on 5433, Redis on 6380).

## Review Focus

1. **Links with the same `created_at` millisecond.** Paging with `limit=1` must return every link exactly once (the `public_id` tiebreaker). Tested in Task 5.
2. **Tampered, truncated or non-JSON cursor, or a `createdAt` cursor with a non-date key.** Must return `400 BAD_REQUEST`, never a 500 from Postgres. Tested in Task 1 and Task 4.
3. **Old request shape `{ url, customAlias }`.** Must return a 400 naming the unknown key, not silently create a link with a random code. Tested in Task 4 (schema `.strict()`).
4. **A link ID from another organization, or a malformed ID (`abc`, `link_short`).** Must return 404, never 403 or 500, and must not hit the DB for malformed IDs. Tested in Task 4.
5. **A member removed from the org while their session is still valid.** Must get 403 on every v1 route immediately. Tested in Task 5.

---

## File map

| File | Responsibility |
| ---- | -------------- |
| `src/common/ids.ts` (new) | CSPRNG base62 strings, prefixed public IDs |
| `src/common/cursor.ts` (new) | Opaque keyset cursor encode/decode |
| `src/common/middleware/rate-limit.ts` (new, moved out of `app.ts`) | Redis-backed `limiter()` factory |
| `src/modules/auth/permissions.ts` (new) | Access-control statements, roles, `can()`, `canManageAll()` |
| `src/modules/auth/auth.middleware.ts` (modify) | `req.roles`; new `requirePermission()` |
| `src/lib/auth.ts` (modify) | Pass `ac` and `roles` to `organization()` |
| `src/db/schema.ts` (modify) + `drizzle/0006_link_public_id.sql` | `public_id`, `created_at(3)`, keyset indexes |
| `src/modules/analytics/{attribution,click-analytics,click-recorder,analytics.repository}.ts` | Click capture (moved from `url/`) |
| `src/modules/links/{codes,sqids,link-cache,links.repository,links.service,links.schema,links.controller,links.routes}.ts` | Link CRUD (replaces `url/`) |
| `src/modules/redirect/{redirect.service,redirect.controller,redirect.routes}.ts` | Public `/:code[/:channel]` |
| `src/routes/v1.ts` (new) | Mounts v1 groups behind auth + org guards |
| `src/app.ts`, `src/index.ts`, `src/db/migrate.ts` (modify) | Wiring |
| `src/modules/url/` (delete) | Replaced |

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/link-platform-v1
```

- [ ] **Step 2: Commit the pre-existing working-tree changes as a baseline (only with the user's OK)**

The tree has uncommitted user work: owner/admin delete rights, `EMAIL_FROM` parsing, docs, `bruno/`, `docs/api/`. Plan code builds on it. Commit it separately so phase A's diff stays clean:

```bash
git add -A -- . ':!docs/superpowers'
git commit -m "chore: baseline member/admin link rights, docs and Bruno collection"
git add docs/superpowers
git commit -m "docs: link platform v1 design spec and phase A plan"
```

---

### Task 1: IDs, codes and cursor utilities

**Files:**
- Create: `src/common/ids.ts`, `src/common/cursor.ts`, `src/modules/links/codes.ts`
- Move: `src/modules/url/sqids.ts` → `src/modules/links/sqids.ts`
- Delete: `src/modules/url/short-code.ts`
- Modify: `src/db/migrate.ts` (imports)
- Test: `tests/ids.test.ts`, `tests/cursor.test.ts`, `tests/sqids.test.ts` (import path)

**Interfaces:**
- Produces:
  - `randomBase62(length: number): string`
  - `newPublicId(prefix: "link" | "tag"): string`
  - `interface Cursor { k: string | number; id: string }`
  - `encodeCursor(c: Cursor): string`
  - `decodeCursor(raw: string): Cursor` (throws `BadRequestError("cursor: invalid")`)
  - `CODE_LENGTH = 7`, `generateCode(): string`, `CODE_PATTERN: RegExp`
  - `isReservedCode(code: string): boolean`, `isPossibleCode(code: string): boolean`

- [ ] **Step 1: Write the failing tests**

`tests/ids.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newPublicId, randomBase62 } from "../src/common/ids";
import { generateCode, isPossibleCode, isReservedCode } from "../src/modules/links/codes";

describe("ids", () => {
  it("generates base62 strings of the requested length", () => {
    expect(randomBase62(24)).toMatch(/^[0-9A-Za-z]{24}$/);
    expect(randomBase62(0)).toBe("");
  });

  it("prefixes public ids", () => {
    expect(newPublicId("link")).toMatch(/^link_[0-9A-Za-z]{24}$/);
    expect(newPublicId("tag")).toMatch(/^tag_[0-9A-Za-z]{24}$/);
    expect(newPublicId("link")).not.toBe(newPublicId("link"));
  });
});

describe("codes", () => {
  it("generates 7-char codes", () => {
    expect(generateCode()).toMatch(/^[0-9A-Za-z]{7}$/);
  });

  it("knows which strings can be codes", () => {
    expect(isPossibleCode("abc1234")).toBe(true);
    expect(isPossibleCode("promo_2026-x")).toBe(true);
    for (const bad of ["ab", "a".repeat(33), "favicon.ico", "api", "API", "a/b"]) {
      expect(isPossibleCode(bad)).toBe(false);
    }
    expect(isReservedCode("Health")).toBe(true);
  });
});
```

`tests/cursor.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor } from "../src/common/cursor";
import { BadRequestError } from "../src/common/errors";

describe("cursor", () => {
  it("round-trips", () => {
    const c = { k: "2026-10-08T10:00:00.123Z", id: "link_abc" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor({ k: 42, id: "link_x" }))).toEqual({ k: 42, id: "link_x" });
  });

  it("is URL-safe", () => {
    expect(encodeCursor({ k: "??>>~~", id: "link_x" })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects tampered or malformed cursors with a 400", () => {
    const bad = [
      "",
      "not-base64!!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from('{"k":1}').toString("base64url"),
      Buffer.from('{"k":{},"id":"x"}').toString("base64url"),
      encodeCursor({ k: 1, id: "link_x" }).slice(0, -3),
    ];
    for (const raw of bad) expect(() => decodeCursor(raw)).toThrow(BadRequestError);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run test tests/ids.test.ts tests/cursor.test.ts`
Expected: FAIL. The modules `../src/common/ids` and `../src/common/cursor` can't be resolved.

- [ ] **Step 3: Implement**

`src/common/ids.ts`:
```ts
import { randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A uniformly random base62 string (CSPRNG, no modulo bias). */
export const randomBase62 = (length: number): string => {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
};

/**
 * Immutable public identifier for an API resource: `link_…` / `tag_…` with 24
 * base62 chars (~143 bits). Internal bigserial ids never leave the server.
 */
export const newPublicId = (prefix: "link" | "tag"): string => `${prefix}_${randomBase62(24)}`;
```

`src/common/cursor.ts`:
```ts
import { z } from "zod";
import { BadRequestError } from "./errors";

/** Keyset position: the last row's sort key plus its public id as tiebreaker. */
export interface Cursor {
  k: string | number;
  id: string;
}

const cursorSchema = z.object({
  k: z.union([z.string().max(64), z.number()]),
  id: z.string().min(1).max(64),
});

/** Opaque, URL-safe cursor for `?cursor=`. */
export const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c)).toString("base64url");

/** Parses a client-supplied cursor; anything malformed is a 400, never a 500. */
export const decodeCursor = (raw: string): Cursor => {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    throw new BadRequestError("cursor: invalid");
  }
};
```

`src/modules/links/codes.ts`:
```ts
import { randomBase62 } from "../../common/ids";

/**
 * 62^7 ≈ 3.5 trillion codes. At 10M links a random guess hits ~1 in 350k, and
 * an insert collides ~1 in 350k (retried by the service).
 */
export const CODE_LENGTH = 7;

/** A uniformly random, unguessable short code. */
export const generateCode = (): string => randomBase62(CODE_LENGTH);

/** Every code (custom or generated) has this shape; anything else can't exist. */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/** Codes that would collide with real routes and are therefore disallowed. */
const RESERVED_CODES = new Set(["api", "health", "ready", "favicon.ico", "robots.txt"]);

export const isReservedCode = (code: string): boolean => RESERVED_CODES.has(code.toLowerCase());

/** True when `code` could name a link: right shape and not a route. */
export const isPossibleCode = (code: string): boolean =>
  CODE_PATTERN.test(code) && !isReservedCode(code);
```

Move sqids and delete the old generator:
```bash
git mv src/modules/url/sqids.ts src/modules/links/sqids.ts
git rm src/modules/url/short-code.ts
```

In `src/db/migrate.ts`, replace the two imports:
```ts
import { encodeId } from "../modules/links/sqids";
import { generateCode } from "../modules/links/codes";
```

In `tests/sqids.test.ts`, change the import to `../src/modules/links/sqids`.

In `src/modules/url/url.service.ts`, change `import { generateCode } from "./short-code";` to `import { generateCode } from "../links/codes";`. This is temporary; the file is deleted in Task 4.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat: base62 public ids, keyset cursor, shared code rules"
```

---

### Task 2: Permissions, `requirePermission`, rate-limit module

**Files:**
- Create: `src/modules/auth/permissions.ts`, `src/common/middleware/rate-limit.ts`
- Modify: `src/modules/auth/auth.middleware.ts`, `src/lib/auth.ts`, `src/app.ts` (limiter import), `src/modules/url/url.controller.ts` (temporary, `isOrgAdmin` → `canManageAll(req.roles)`)
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Produces:
  - `ac`, `roles` (owner/admin/member)
  - `type Resource = "link" | "tag" | "analytics"`
  - `type Action<R>`
  - `can(memberRoles: string[], resource, action): boolean`
  - `canManageAll(memberRoles: string[]): boolean`
  - `requirePermission(resource, action)` middleware
  - `AuthenticatedRequest.roles?: string[]` (replaces `isOrgAdmin`)
  - `limiter(prefix: string, windowMs: number, max: number)`

- [ ] **Step 1: Write the failing test**

`tests/permissions.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test tests/permissions.test.ts`
Expected: FAIL. `../src/modules/auth/permissions` can't be resolved.

- [ ] **Step 3: Implement**

`src/modules/auth/permissions.ts`:
```ts
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
```

If `typecheck` rejects `{ ...ownerAc.statements, ...appAccess }` because of readonly tuples, spread each action array instead (`link: [...appAccess.link]`). Behaviour stays the same.

`src/modules/auth/auth.middleware.ts`: replace the `isOrgAdmin` field and the end of `requireOrganization`, and add `requirePermission`. Full file:
```ts
import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ForbiddenError, UnauthorizedError } from "../../common/errors";
import { asyncHandler } from "../../common/asyncHandler";
import { auth } from "../../lib/auth";
import { getMemberRoles } from "../../lib/org-bootstrap";
import { can, type Action, type Resource } from "./permissions";

/**
 * Adds the authenticated user id, active organization (tenant) and the
 * caller's roles in it to the request once verified.
 */
export interface AuthenticatedRequest extends Request {
  userId?: string;
  organizationId?: string;
  /** The caller's roles in the active organization (set by requireOrganization). */
  roles?: string[];
}

/**
 * Guards routes that require authentication. Resolves the session from the
 * request — the `bearer` plugin accepts an `Authorization: Bearer <token>`
 * header (the session token returned on sign-in), so no cookies are required.
 * Attaches `req.userId` and the active `req.organizationId` (from the
 * organization plugin) on success, otherwise throws 401.
 */
export const requireAuth = asyncHandler(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new UnauthorizedError("Authentication required");
    req.userId = session.user.id;
    req.organizationId = session.session.activeOrganizationId ?? undefined;
    next();
  },
);

/**
 * Guards routes that operate on tenant-scoped resources. Must run after
 * `requireAuth`. Ensures an organization is active for the session AND that the
 * user is still a member of it: a session's active organization is not cleared
 * when an admin removes someone, so it can't be trusted on its own. Callers can
 * switch tenants via `POST /api/auth/organization/set-active`.
 */
export const requireOrganization = asyncHandler(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.organizationId) {
      throw new ForbiddenError("No active organization. Select one to continue.");
    }
    const roles = await getMemberRoles(req.userId!, req.organizationId);
    if (!roles) throw new ForbiddenError("You are no longer a member of this organization.");
    req.roles = roles;
    next();
  },
);

/**
 * Guards a route by role permission. Must run after `requireOrganization`;
 * uses the roles it loaded, so it costs no extra query.
 */
export const requirePermission =
  <R extends Resource>(resource: R, action: Action<R>) =>
  (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!can(req.roles ?? [], resource, action)) {
      throw new ForbiddenError(`Your role does not allow ${resource}:${action}`);
    }
    next();
  };
```

In `src/modules/url/url.controller.ts` (temporary until Task 4), replace `isOrgAdmin: req.isOrgAdmin ?? false` with `isOrgAdmin: canManageAll(req.roles ?? [])` and add `import { canManageAll } from "../auth/permissions";`.

In `src/lib/auth.ts`, add `import { ac, roles } from "../modules/auth/permissions";`, and in `organization({ … })` add `ac,` and `roles,` as the first two keys.

`src/common/middleware/rate-limit.ts`: move `rateLimitHandler`, `LazyRedisStore` and `limiter` out of `app.ts` verbatim, exporting only `limiter`:
```ts
import type express from "express";
import rateLimit, { type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../../lib/redis";

/** Consistent 429 body matching our error envelope. */
const rateLimitHandler = (_req: express.Request, res: express.Response) =>
  res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });

/**
 * RedisStore loads its Lua scripts in the constructor; if Redis isn't up yet
 * that promise rejects unobserved. The store reloads scripts on first use, so
 * those early failures are safe to ignore.
 */
class LazyRedisStore extends RedisStore {
  constructor(...args: ConstructorParameters<typeof RedisStore>) {
    super(...args);
    this.incrementScriptSha.catch(() => {});
    this.getScriptSha.catch(() => {});
  }
}

/**
 * A rate limiter whose counters live in Redis when configured, so the limit is
 * shared by every instance. Fails open if Redis is unreachable.
 */
export const limiter = (prefix: string, windowMs: number, max: number) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    passOnStoreError: true,
    ...(redis && {
      store: new LazyRedisStore({
        prefix: `rl:${prefix}:`,
        sendCommand: (...args: string[]) => redis!.sendCommand(args),
      }) as Options["store"],
    }),
  });
```
In `src/app.ts`:
- Delete those three definitions and the now-unused imports (`rateLimit`, `Options`, `RedisStore`, `redis`).
- Add `import { limiter } from "./common/middleware/rate-limit";`.

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat: org role permissions and requirePermission guard"
```

---

### Task 3: Schema — `public_id`, millisecond `created_at`, keyset indexes

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0006_link_public_id.sql` (+ `drizzle/meta/0006_snapshot.json` and the `_journal.json` entry, generated)

**Interfaces:**
- Produces: `urls.publicId` (text, unique, not null); `Url` gains `publicId: string`.

- [ ] **Step 1: Edit the `urls` table in `src/db/schema.ts`**

Inside `pgTable("urls", { … })`, add after `id`:
```ts
    // Immutable public identifier (`link_…`) used by the API; the bigserial id
    // stays internal.
    publicId: text("public_id").notNull().unique(),
```
Change `createdAt` to millisecond precision. JS `Date`s carry milliseconds, so keyset cursors must round-trip exactly:
```ts
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
```
Replace the index list:
```ts
  (t) => [
    // Keyset pagination: (sort key, public_id) within an organization.
    index("urls_org_created_idx").on(t.organizationId, t.createdAt, t.publicId),
    index("urls_org_clicks_idx").on(t.organizationId, t.clickCount, t.publicId),
    index("urls_user_id_created_at_idx").on(t.userId, t.createdAt),
  ],
```
Update the table's doc comment. Replace the Sqids paragraph with:
```ts
/**
 * Shortened URLs. `publicId` is the stable API identity; `code` is the
 * editable path segment (custom or random) in one unique namespace.
 */
```

- [ ] **Step 2: Generate the migration**

Run: `docker compose up -d postgres && bun run db:generate --name link_public_id`
Expected: creates `drizzle/0006_link_public_id.sql` plus the snapshot and journal entry.

- [ ] **Step 3: Replace the generated SQL with a backfilling version**

The generated `ADD COLUMN … NOT NULL` fails on existing rows. Overwrite `drizzle/0006_link_public_id.sql` with:
```sql
ALTER TABLE "urls" ADD COLUMN "public_id" text;--> statement-breakpoint
-- Backfill existing links. The subquery references the outer row so random()
-- is evaluated per row, not once for the whole UPDATE.
UPDATE "urls" SET "public_id" = 'link_' || (
	SELECT string_agg(substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 1 + floor(random() * 62)::int, 1), '')
	FROM generate_series(1, 24 + 0 * "urls"."id")
) WHERE "public_id" IS NULL;--> statement-breakpoint
ALTER TABLE "urls" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "urls" ADD CONSTRAINT "urls_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "urls" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "urls_organization_id_created_at_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_org_created_idx" ON "urls" USING btree ("organization_id","created_at","public_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "urls_org_clicks_idx" ON "urls" USING btree ("organization_id","click_count","public_id");
```

- [ ] **Step 4: Apply the migration and verify it**

Run: `bun run db:migrate`
Expected: `Migrations applied.`

Then check:
```bash
docker compose exec postgres psql -U postgres -d url_shortener -c "SELECT count(*) AS total, count(DISTINCT public_id) AS distinct_ids, bool_and(public_id ~ '^link_[0-9A-Za-z]{24}$') AS well_formed FROM urls;"
```
Expected: `total = distinct_ids` and `well_formed = t` (or `null` if the table is empty).

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`. Expected errors appear only in `src/modules/url/*` and `tests/url.service.test.ts` (`publicId` missing); Task 4 replaces both. Then:
```bash
git add src/db/schema.ts drizzle
git commit -m "feat(db): link public ids, ms created_at, keyset indexes"
```

---

### Task 4: Split `url/` into `analytics/`, `links/` and `redirect/`; serve `/api/v1/links`

**Files:**
- Move: `src/modules/url/{attribution,click-analytics,click-recorder}.ts` → `src/modules/analytics/`
- Move: `src/modules/url/link-cache.ts` → `src/modules/links/link-cache.ts`
- Create:
  - `src/modules/analytics/analytics.repository.ts`
  - `src/modules/links/links.{repository,service,schema,controller,routes}.ts`
  - `src/modules/redirect/redirect.{service,controller,routes}.ts`
  - `src/routes/v1.ts`
- Modify: `src/app.ts`, `src/index.ts`
- Delete: `src/modules/url/` (rest), `tests/url.service.test.ts`, `tests/url.schema.test.ts`
- Test:
  - Create: `tests/links.service.test.ts`, `tests/links.schema.test.ts`, `tests/redirect.service.test.ts`
  - Modify: `tests/app.test.ts`, `tests/attribution.test.ts`, `tests/click-analytics.test.ts`, `tests/click-recorder.test.ts`

**Interfaces:**
- Consumes from Tasks 1–3: `newPublicId`, `encodeCursor`, `decodeCursor`, `Cursor`, `generateCode`, `isReservedCode`, `isPossibleCode`, `CODE_PATTERN`, `canManageAll`, `requirePermission`, `limiter`, `Url.publicId`.
- Produces:
  - `AnalyticsRepository` (`recordClicks`, `deleteClicksBefore`, `sourceBreakdown`, `recentClicks`), `analyticsRepository`, `ClickRow`
  - `clickRecorder` (singleton, in `click-recorder.ts`)
  - `LinkCache`, `linkCache` (singleton)
  - `LinksRepository`:
    - `create(data: CreateLinkData)`
    - `findByCode(code)`
    - `findByPublicId(orgId, publicId)`
    - `list(params: ListLinksParams)`
    - `softDelete(id, orgId)`
  - `LinksService`:
    - `create(actor, input)`
    - `list(orgId, input)`
    - `get(orgId, id)`
    - `remove(actor, id)`
  - Types: `LinkView`, `Page<T>`, `Actor { organizationId; userId; canManageAll }`, `CreateLinkInput`, `ListLinksInput`
  - `destinationUrlSchema`, `createLinkSchema`, `listLinksQuerySchema`
  - `RedirectService.resolve(code, meta): Promise<string>`, `redirectService`
  - `v1Routes`, `redirectRoutes`

- [ ] **Step 1: Move the analytics files and fix their tests**

```bash
mkdir -p src/modules/analytics src/modules/links src/modules/redirect src/routes
git mv src/modules/url/attribution.ts src/modules/analytics/attribution.ts
git mv src/modules/url/click-analytics.ts src/modules/analytics/click-analytics.ts
git mv src/modules/url/click-recorder.ts src/modules/analytics/click-recorder.ts
git mv src/modules/url/link-cache.ts src/modules/links/link-cache.ts
sed -i '' 's#src/modules/url/attribution#src/modules/analytics/attribution#' tests/attribution.test.ts
sed -i '' 's#src/modules/url/click-analytics#src/modules/analytics/click-analytics#' tests/click-analytics.test.ts
sed -i '' 's#src/modules/url/click-recorder#src/modules/analytics/click-recorder#; s#src/modules/url/url.repository#src/modules/analytics/analytics.repository#' tests/click-recorder.test.ts
```

- [ ] **Step 2: Create `src/modules/analytics/analytics.repository.ts`**

This moves the click methods out of `UrlRepository` unchanged:
```ts
import { count, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { clicks, urls, type Click } from "../../db/schema";
import type { ClickData } from "./click-analytics";

/** One click to persist, as buffered by the ClickRecorder. */
export interface ClickRow extends ClickData {
  urlId: number;
  createdAt: Date;
}

/** Data access for click analytics. */
export class AnalyticsRepository {
  /**
   * Persists a batch of clicks: one multi-row insert plus one counter update per
   * distinct URL, so a hot link costs one row lock per batch, not per click.
   */
  async recordClicks(rows: ClickRow[]): Promise<void> {
    if (!rows.length) return;
    const perUrl = new Map<number, number>();
    for (const r of rows) perUrl.set(r.urlId, (perUrl.get(r.urlId) ?? 0) + 1);
    const deltas = sql.join(
      [...perUrl].map(([id, n]) => sql`(${id}::bigint, ${n}::bigint)`),
      sql`, `,
    );

    await db.transaction(async (tx) => {
      await tx.insert(clicks).values(rows);
      await tx.execute(sql`
        UPDATE ${urls} SET click_count = ${urls.clickCount} + d.n
        FROM (VALUES ${deltas}) AS d(id, n)
        WHERE ${urls.id} = d.id`);
    });
  }

  /** Deletes click analytics older than the cutoff (retention policy). */
  async deleteClicksBefore(cutoff: Date): Promise<number> {
    const result = await db.delete(clicks).where(lt(clicks.createdAt, cutoff));
    return result.rowCount ?? 0;
  }

  /** Click counts per attributed source, biggest first. */
  sourceBreakdown(urlId: number) {
    const source = sql<string>`coalesce(${clicks.source}, 'unknown')`;
    const method = sql<string>`coalesce(${clicks.sourceMethod}, 'none')`;
    const clicksCount = count();
    return db
      .select({ source, method, clicks: clicksCount })
      .from(clicks)
      .where(eq(clicks.urlId, urlId))
      .groupBy(source, method)
      .orderBy(desc(clicksCount), source, method);
  }

  /** Most recent clicks for a URL. */
  recentClicks(urlId: number, limit: number): Promise<Click[]> {
    return db.query.clicks.findMany({
      where: eq(clicks.urlId, urlId),
      orderBy: desc(clicks.createdAt),
      limit,
    });
  }
}

export const analyticsRepository = new AnalyticsRepository();
```

In `src/modules/analytics/click-recorder.ts`, change the repository import and add the singleton at the end of the file:
```ts
import { analyticsRepository, type AnalyticsRepository, type ClickRow } from "./analytics.repository";
```
Change the constructor parameter type to `Pick<AnalyticsRepository, "recordClicks">`, and append:
```ts
export const clickRecorder = new ClickRecorder(analyticsRepository);
```

In `src/modules/links/link-cache.ts`, append:
```ts
/** Process-wide redirect cache shared by link management and redirects. */
export const linkCache = new LinkCache();
```

- [ ] **Step 3: Write the failing links and redirect tests**

`tests/links.schema.test.ts` (replaces `url.schema.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { createLinkSchema, listLinksQuerySchema } from "../src/modules/links/links.schema";

const ok = (url: string) => createLinkSchema.safeParse({ url }).success;

describe("createLinkSchema", () => {
  it("accepts plain http(s) URLs", () => {
    expect(ok("https://example.com/a?b=c")).toBe(true);
  });

  it("rejects non-http, embedded credentials, and self-links", () => {
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("https://bank.com@evil.com/login")).toBe(false);
    expect(ok("http://localhost:3000/abc1234")).toBe(false); // BASE_URL in tests
  });

  it("validates the optional code", () => {
    expect(createLinkSchema.safeParse({ url: "https://a.com", code: "promo" }).success).toBe(true);
    expect(createLinkSchema.safeParse({ url: "https://a.com", code: "a b" }).success).toBe(false);
  });

  it("rejects unknown keys such as the old customAlias", () => {
    const res = createLinkSchema.safeParse({ url: "https://a.com", customAlias: "promo" });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("customAlias");
  });
});

describe("listLinksQuerySchema", () => {
  it("applies defaults", () => {
    expect(listLinksQuerySchema.parse({})).toEqual({ limit: 20, sort: "createdAt", order: "desc" });
  });

  it("bounds limit and enumerates sort/order", () => {
    expect(listLinksQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(listLinksQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(listLinksQuerySchema.safeParse({ sort: "code" }).success).toBe(false);
    expect(listLinksQuerySchema.parse({ limit: "5", sort: "clicks", order: "asc" })).toEqual({
      limit: 5,
      sort: "clicks",
      order: "asc",
    });
  });
});
```

`tests/links.service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinksService, type Actor } from "../src/modules/links/links.service";
import type { LinksRepository } from "../src/modules/links/links.repository";
import { LinkCache } from "../src/modules/links/link-cache";
import { decodeCursor, encodeCursor } from "../src/common/cursor";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../src/common/errors";
import type { Url } from "../src/db/schema";

const LINK_ID = "link_AAAAAAAAAAAAAAAAAAAAAAAA";

/** Builds a Url row with sensible defaults. */
const makeUrl = (over: Partial<Url> = {}): Url => ({
  id: 1,
  publicId: LINK_ID,
  code: "abc1234",
  originalUrl: "https://example.com",
  organizationId: "org-1",
  userId: "user-1",
  clickCount: 0,
  expiresAt: null,
  deletedAt: null,
  createdAt: new Date("2026-10-08T10:00:00.123Z"),
  ...over,
});

const makeRepo = () => ({
  create: vi.fn(),
  findByCode: vi.fn(),
  findByPublicId: vi.fn(),
  list: vi.fn(),
  softDelete: vi.fn(),
});

const owner: Actor = { organizationId: "org-1", userId: "user-1", canManageAll: true };
const member: Actor = { organizationId: "org-1", userId: "user-2", canManageAll: false };

let repo: ReturnType<typeof makeRepo>;
let cache: LinkCache;
let service: LinksService;

beforeEach(() => {
  repo = makeRepo();
  cache = new LinkCache();
  service = new LinksService(repo as unknown as LinksRepository, cache);
});

describe("create", () => {
  it("stores a random 7-char code and a public id", async () => {
    repo.create.mockImplementation((d: Partial<Url>) => makeUrl(d));
    const link = await service.create(owner, { url: "https://x.com" });
    expect(link.id).toMatch(/^link_[0-9A-Za-z]{24}$/);
    expect(link.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(link.shortUrl).toBe(`http://localhost:3000/${link.code}`);
    expect(link.shareUrls.instagram).toBe(`${link.shortUrl}/ig`);
    expect(link.url).toBe("https://x.com");
    expect(link.createdBy).toBe("user-1");
    expect(link).not.toHaveProperty("organizationId");
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", userId: "user-1" }),
    );
  });

  it("retries a colliding random code", async () => {
    repo.create
      .mockRejectedValueOnce({ code: "23505" })
      .mockImplementation((d: Partial<Url>) => makeUrl(d));
    await service.create(owner, { url: "https://x.com" });
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it("stores a custom code", async () => {
    repo.create.mockImplementation((d: Partial<Url>) => makeUrl(d));
    const link = await service.create(owner, { url: "https://x.com", code: "promo" });
    expect(link.code).toBe("promo");
  });

  it("rejects a reserved code", async () => {
    await expect(service.create(owner, { url: "https://x.com", code: "api" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("maps a taken custom code to 409 without retrying", async () => {
    repo.create.mockRejectedValue({ code: "23505" });
    await expect(
      service.create(owner, { url: "https://x.com", code: "abc1234" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).toHaveBeenCalledOnce();
  });
});

describe("list", () => {
  const input = { sort: "createdAt" as const, order: "desc" as const, limit: 2 };

  it("fetches limit+1 and returns a cursor when more rows exist", async () => {
    const rows = [
      makeUrl({ publicId: "link_a" }),
      makeUrl({ publicId: "link_b" }),
      makeUrl({ publicId: "link_c" }),
    ];
    repo.list.mockResolvedValue(rows);
    const page = await service.list("org-1", input);
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 3, organizationId: "org-1" }));
    expect(page.data.map((l) => l.id)).toEqual(["link_a", "link_b"]);
    expect(decodeCursor(page.nextCursor!)).toEqual({ k: "2026-10-08T10:00:00.123Z", id: "link_b" });
  });

  it("returns a null cursor on the last page", async () => {
    repo.list.mockResolvedValue([makeUrl()]);
    expect((await service.list("org-1", input)).nextCursor).toBeNull();
  });

  it("uses click_count as the key when sorting by clicks", async () => {
    repo.list.mockResolvedValue([
      makeUrl({ publicId: "link_a", clickCount: 9 }),
      makeUrl({ publicId: "link_b", clickCount: 7 }),
      makeUrl({ publicId: "link_c", clickCount: 1 }),
    ]);
    const page = await service.list("org-1", { ...input, sort: "clicks" });
    expect(decodeCursor(page.nextCursor!)).toEqual({ k: 7, id: "link_b" });
  });

  it("passes a decoded cursor to the repository", async () => {
    repo.list.mockResolvedValue([]);
    const cursor = encodeCursor({ k: "2026-10-08T10:00:00.123Z", id: "link_b" });
    await service.list("org-1", { ...input, cursor });
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { k: "2026-10-08T10:00:00.123Z", id: "link_b" } }),
    );
  });

  it("rejects a createdAt cursor whose key is not a date (400, not a DB error)", async () => {
    const cursor = encodeCursor({ k: "yesterday-ish", id: "link_b" });
    await expect(service.list("org-1", { ...input, cursor })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("rejects a clicks cursor whose key is not a number", async () => {
    const cursor = encodeCursor({ k: "abc", id: "link_b" });
    await expect(
      service.list("org-1", { ...input, sort: "clicks", cursor }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("get", () => {
  it("returns an org-owned link", async () => {
    repo.findByPublicId.mockResolvedValue(makeUrl());
    expect((await service.get("org-1", LINK_ID)).id).toBe(LINK_ID);
    expect(repo.findByPublicId).toHaveBeenCalledWith("org-1", LINK_ID);
  });

  it("404s a link the org doesn't own", async () => {
    repo.findByPublicId.mockResolvedValue(undefined);
    await expect(service.get("org-1", LINK_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404s malformed ids without touching the DB", async () => {
    for (const id of ["abc", "link_short", `tag_${"A".repeat(24)}`, `link_${"A".repeat(23)}!`]) {
      await expect(service.get("org-1", id)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(repo.findByPublicId).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it("lets a member delete only their own links", async () => {
    repo.findByPublicId.mockResolvedValue(makeUrl({ userId: "user-1" }));
    await expect(service.remove(member, LINK_ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.softDelete).not.toHaveBeenCalled();

    repo.findByPublicId.mockResolvedValue(makeUrl({ userId: "user-2" }));
    repo.softDelete.mockResolvedValue(true);
    await expect(service.remove(member, LINK_ID)).resolves.toBeUndefined();
  });

  it("lets an owner/admin delete any link", async () => {
    repo.findByPublicId.mockResolvedValue(makeUrl({ userId: "someone-else" }));
    repo.softDelete.mockResolvedValue(true);
    await expect(service.remove(owner, LINK_ID)).resolves.toBeUndefined();
  });

  it("404s when nothing was deleted", async () => {
    repo.findByPublicId.mockResolvedValue(makeUrl());
    repo.softDelete.mockResolvedValue(false);
    await expect(service.remove(owner, LINK_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("evicts the cached redirect", async () => {
    cache.set("abc1234", { id: 1, originalUrl: "https://example.com", expiresAt: null });
    repo.findByPublicId.mockResolvedValue(makeUrl());
    repo.softDelete.mockResolvedValue(true);
    await service.remove(owner, LINK_ID);
    expect(cache.get("abc1234")).toBeUndefined();
  });
});
```

`tests/redirect.service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedirectService } from "../src/modules/redirect/redirect.service";
import { LinkCache } from "../src/modules/links/link-cache";
import { GoneError, NotFoundError } from "../src/common/errors";
import type { Url } from "../src/db/schema";

const makeUrl = (over: Partial<Url> = {}): Url => ({
  id: 1,
  publicId: "link_AAAAAAAAAAAAAAAAAAAAAAAA",
  code: "abc1234",
  originalUrl: "https://example.com",
  organizationId: "org-1",
  userId: "user-1",
  clickCount: 0,
  expiresAt: null,
  deletedAt: null,
  createdAt: new Date(),
  ...over,
});

let repo: { findByCode: ReturnType<typeof vi.fn> };
let clicks: { enqueue: ReturnType<typeof vi.fn> };
let service: RedirectService;

beforeEach(() => {
  repo = { findByCode: vi.fn() };
  clicks = { enqueue: vi.fn() };
  service = new RedirectService(repo, clicks, new LinkCache());
});

describe("resolve", () => {
  it("resolves a code and queues the click", async () => {
    repo.findByCode.mockResolvedValue(makeUrl({ id: 9, originalUrl: "https://t.com" }));
    expect(await service.resolve("abc1234", { ip: "1.2.3.4" })).toBe("https://t.com");
    expect(clicks.enqueue).toHaveBeenCalledWith(9, { ip: "1.2.3.4" });
  });

  it("serves repeat lookups from cache", async () => {
    repo.findByCode.mockResolvedValue(makeUrl());
    await service.resolve("abc1234", {});
    await service.resolve("abc1234", {});
    expect(repo.findByCode).toHaveBeenCalledOnce();
  });

  it("404s impossible codes without touching the DB", async () => {
    for (const code of ["favicon.ico", "api", "x", "a".repeat(40)]) {
      await expect(service.resolve(code, {})).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(repo.findByCode).not.toHaveBeenCalled();
  });

  it("404s an unknown code", async () => {
    repo.findByCode.mockResolvedValue(undefined);
    await expect(service.resolve("nope", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("410s an expired link without counting it", async () => {
    repo.findByCode.mockResolvedValue(makeUrl({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.resolve("abc1234", {})).rejects.toBeInstanceOf(GoneError);
    expect(clicks.enqueue).not.toHaveBeenCalled();
  });
});
```

Replace `tests/app.test.ts` with:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

// These paths never touch the database (validation / auth guards / routing).
const app = createApp();

describe("app routing & guards", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects an unauthenticated request to a v1 route", async () => {
    for (const path of ["/api/v1/links", "/api/v1/links/link_x"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("no longer serves the legacy /api/urls routes", async () => {
    expect((await request(app).get("/api/urls")).status).toBe(404);
  });

  it("rejects sign-up with an invalid email / short password", async () => {
    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "x", email: "not-an-email", password: "short" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("404s an unknown route", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/v1/links")
      .set("Content-Type", "application/json")
      .send('{"url": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});
```

Delete the old tests:
```bash
git rm tests/url.service.test.ts tests/url.schema.test.ts
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `bun run test`
Expected: FAIL. `links.schema`, `links.service`, `links.repository` and `redirect.service` modules can't be resolved.

- [ ] **Step 5: Implement the links module**

`src/modules/links/links.schema.ts`:
```ts
import { z } from "zod";
import { env } from "../../config/env";
import { CODE_PATTERN } from "./codes";

const ownHost = new URL(env.BASE_URL).host.toLowerCase();

/** A redirect target: http(s), bounded, no credentials, not this shortener. */
export const destinationUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL")
  // "https://bank.com@evil.com" is a classic phishing disguise.
  .refine((u) => {
    const { username, password } = new URL(u);
    return !username && !password;
  }, "must not contain credentials")
  // Pointing at ourselves enables redirect loops and chain obfuscation.
  .refine((u) => new URL(u).host.toLowerCase() !== ownHost, "must not point to this shortener");

export const codeSchema = z.string().regex(CODE_PATTERN, "3-32 chars: letters, digits, - or _");

export const futureDateSchema = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now(), "must be in the future");

/** POST /api/v1/links. Unknown keys are rejected so typos fail loudly. */
export const createLinkSchema = z
  .object({
    url: destinationUrlSchema,
    code: codeSchema.optional(),
    expiresAt: futureDateSchema.optional(),
  })
  .strict();

/** GET /api/v1/links: keyset pagination and sort. */
export const listLinksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  sort: z.enum(["createdAt", "clicks"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateLinkBody = z.infer<typeof createLinkSchema>;
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;
```

The `.strict()` rejection message is produced by the existing `validate.ts` `firstIssue()`. For unrecognized keys Zod's message is `Unrecognized key(s) in object: 'customAlias'` with an empty path, so the 400 names the key.

`src/modules/links/links.repository.ts`:
```ts
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Cursor } from "../../common/cursor";
import { db } from "../../db/client";
import { urls, type Url } from "../../db/schema";

/** Fields needed to create a link. */
export interface CreateLinkData {
  publicId: string;
  originalUrl: string;
  organizationId: string;
  userId: string;
  code: string;
  expiresAt?: Date;
}

export type LinkSort = "createdAt" | "clicks";

/** One keyset page request. `cursor.k` is already validated for `sort`. */
export interface ListLinksParams {
  organizationId: string;
  sort: LinkSort;
  order: "asc" | "desc";
  limit: number;
  cursor?: Cursor;
}

/** Live (not soft-deleted) links of one organization. */
const liveIn = (organizationId: string) =>
  and(eq(urls.organizationId, organizationId), isNull(urls.deletedAt));

/** Data-access layer for links. */
export class LinksRepository {
  /** Inserts a link; a taken `code` raises a unique violation (23505). */
  async create(data: CreateLinkData): Promise<Url> {
    const [row] = await db
      .insert(urls)
      .values({ ...data, expiresAt: data.expiresAt ?? null })
      .returning();
    return row;
  }

  /** Finds a live link by its short code (redirect path). */
  findByCode(code: string): Promise<Url | undefined> {
    return db.query.urls.findFirst({ where: and(eq(urls.code, code), isNull(urls.deletedAt)) });
  }

  /** Finds a live link by public id within an organization. */
  findByPublicId(organizationId: string, publicId: string): Promise<Url | undefined> {
    return db.query.urls.findFirst({
      where: and(liveIn(organizationId), eq(urls.publicId, publicId)),
    });
  }

  /**
   * One keyset page ordered by (sort key, public_id). Served by the
   * (organization_id, key, public_id) indexes, so deep pages cost the same as
   * the first.
   */
  list({ organizationId, sort, order, limit, cursor }: ListLinksParams): Promise<Url[]> {
    const key = sort === "clicks" ? urls.clickCount : urls.createdAt;
    const dir = order === "desc" ? desc : asc;
    let after;
    if (cursor) {
      const k =
        sort === "clicks"
          ? sql`${Number(cursor.k)}::bigint`
          : sql`${String(cursor.k)}::timestamptz`;
      after =
        order === "desc"
          ? sql`(${key}, ${urls.publicId}) < (${k}, ${cursor.id})`
          : sql`(${key}, ${urls.publicId}) > (${k}, ${cursor.id})`;
    }
    return db
      .select()
      .from(urls)
      .where(and(liveIn(organizationId), after))
      .orderBy(dir(key), dir(urls.publicId))
      .limit(limit);
  }

  /** Soft-deletes a link owned by the organization; true if a row was affected. */
  async softDelete(id: number, organizationId: string): Promise<boolean> {
    const deleted = await db
      .update(urls)
      .set({ deletedAt: new Date() })
      .where(and(eq(urls.id, id), liveIn(organizationId)))
      .returning({ id: urls.id });
    return deleted.length > 0;
  }
}

export const linksRepository = new LinksRepository();
```

`src/modules/links/links.service.ts`:
```ts
import { decodeCursor, encodeCursor, type Cursor } from "../../common/cursor";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors";
import { newPublicId } from "../../common/ids";
import { env } from "../../config/env";
import type { Url } from "../../db/schema";
import { assertSafeUrl } from "../../lib/safe-browsing";
import { CHANNELS } from "../analytics/attribution";
import { generateCode, isReservedCode } from "./codes";
import { linkCache, type LinkCache } from "./link-cache";
import { linksRepository, type LinkSort, type LinksRepository } from "./links.repository";

const PG_UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;
const LINK_ID_PATTERN = /^link_[0-9A-Za-z]{24}$/;

/** A link as returned by the API. */
export interface LinkView {
  id: string;
  code: string;
  shortUrl: string;
  url: string;
  /** Per-platform share links, e.g. `{ instagram: "https://…/abc1234/ig" }`. */
  shareUrls: Record<string, string>;
  clicks: number;
  createdBy: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/** A keyset page. `nextCursor` is null on the last page. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Who is acting, and whether they may manage every member's links. */
export interface Actor {
  organizationId: string;
  userId: string;
  canManageAll: boolean;
}

export interface CreateLinkInput {
  url: string;
  code?: string;
  expiresAt?: Date;
}

export interface ListLinksInput {
  sort: LinkSort;
  order: "asc" | "desc";
  limit: number;
  cursor?: string;
}

const isUniqueViolation = (err: unknown) =>
  !!err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION;

/** A cursor's key must match the sort, or Postgres would 500 on the cast. */
const checkCursor = (raw: string, sort: LinkSort): Cursor => {
  const cursor = decodeCursor(raw);
  const valid =
    sort === "clicks"
      ? Number.isSafeInteger(cursor.k)
      : typeof cursor.k === "string" && !Number.isNaN(Date.parse(cursor.k));
  if (!valid) throw new BadRequestError("cursor: invalid");
  return cursor;
};

/**
 * Link management within an organization. Every link has exactly one code in a
 * single unique column, so a custom code can never shadow another link.
 */
export class LinksService {
  constructor(
    private readonly repo: LinksRepository,
    private readonly cache: Pick<LinkCache, "delete"> = linkCache,
  ) {}

  /** Creates a link with a custom or random code. */
  async create(actor: Actor, input: CreateLinkInput): Promise<LinkView> {
    if (input.code && isReservedCode(input.code)) throw new ConflictError("Code is reserved");
    await assertSafeUrl(input.url);

    const base = {
      publicId: newPublicId("link"),
      originalUrl: input.url,
      organizationId: actor.organizationId,
      userId: actor.userId,
      expiresAt: input.expiresAt,
    };

    if (input.code) {
      try {
        return this.toView(await this.repo.create({ ...base, code: input.code }));
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError("Code already taken");
        throw err;
      }
    }

    // Random codes rarely collide; the unique constraint catches it and we retry.
    for (let attempt = 1; ; attempt++) {
      try {
        return this.toView(await this.repo.create({ ...base, code: generateCode() }));
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= MAX_CODE_ATTEMPTS) throw err;
      }
    }
  }

  /** One page of the organization's links. Fetches one extra row to detect more. */
  async list(organizationId: string, input: ListLinksInput): Promise<Page<LinkView>> {
    const cursor = input.cursor ? checkCursor(input.cursor, input.sort) : undefined;
    const rows = await this.repo.list({
      organizationId,
      sort: input.sort,
      order: input.order,
      limit: input.limit + 1,
      cursor,
    });
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > input.limit && last
        ? encodeCursor({
            k: input.sort === "clicks" ? last.clickCount : last.createdAt.toISOString(),
            id: last.publicId,
          })
        : null;
    return { data: page.map((row) => this.toView(row)), nextCursor };
  }

  /** One link of the organization. */
  async get(organizationId: string, id: string): Promise<LinkView> {
    return this.toView(await this.find(organizationId, id));
  }

  /** Soft-deletes a link. Members may delete only links they created. */
  async remove(actor: Actor, id: string): Promise<void> {
    const url = await this.find(actor.organizationId, id);
    if (!actor.canManageAll && url.userId !== actor.userId) {
      throw new ForbiddenError("Only organization admins can delete other members' links");
    }
    if (!(await this.repo.softDelete(url.id, actor.organizationId))) {
      throw new NotFoundError("Link not found");
    }
    this.cache.delete(url.code);
  }

  /** Org-scoped lookup; another org's link and a malformed id are both 404. */
  private async find(organizationId: string, id: string): Promise<Url> {
    const url = LINK_ID_PATTERN.test(id)
      ? await this.repo.findByPublicId(organizationId, id)
      : undefined;
    if (!url) throw new NotFoundError("Link not found");
    return url;
  }

  /** Maps a DB row to the API shape. */
  private toView(url: Url): LinkView {
    const shortUrl = `${env.BASE_URL}/${url.code}`;
    return {
      id: url.publicId,
      code: url.code,
      shortUrl,
      url: url.originalUrl,
      shareUrls: Object.fromEntries(
        Object.entries(CHANNELS).map(([tag, name]) => [name, `${shortUrl}/${tag}`]),
      ),
      clicks: url.clickCount,
      createdBy: url.userId,
      expiresAt: url.expiresAt,
      createdAt: url.createdAt,
    };
  }
}

export const linksService = new LinksService(linksRepository);
```

`src/modules/links/links.controller.ts`:
```ts
import type { Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import type { AuthenticatedRequest } from "../auth/auth.middleware";
import { canManageAll } from "../auth/permissions";
import type { CreateLinkBody, ListLinksQuery } from "./links.schema";
import { linksService, type Actor } from "./links.service";

const actor = (req: AuthenticatedRequest): Actor => ({
  organizationId: req.organizationId!,
  userId: req.userId!,
  canManageAll: canManageAll(req.roles ?? []),
});

/** HTTP layer for /api/v1/links. */
export const linksController = {
  // POST /api/v1/links — create a link.
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const link = await linksService.create(actor(req), req.body as CreateLinkBody);
    res.status(201).location(`/api/v1/links/${link.id}`).json(link);
  }),

  // GET /api/v1/links — one keyset page of the org's links.
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json(await linksService.list(req.organizationId!, res.locals.query as ListLinksQuery));
  }),

  // GET /api/v1/links/:id — one link.
  get: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json(await linksService.get(req.organizationId!, req.params.id));
  }),

  // DELETE /api/v1/links/:id — soft-delete.
  remove: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await linksService.remove(actor(req), req.params.id);
    res.status(204).send();
  }),
};
```

`src/modules/links/links.routes.ts`:
```ts
import { Router } from "express";
import { validateBody, validateQuery } from "../../common/middleware/validate";
import { requirePermission } from "../auth/auth.middleware";
import { linksController } from "./links.controller";
import { createLinkSchema, listLinksQuerySchema } from "./links.schema";

/** /api/v1/links — mounted behind requireAuth + requireOrganization (routes/v1.ts). */
export const linkRoutes = Router();

linkRoutes.post(
  "/",
  requirePermission("link", "create"),
  validateBody(createLinkSchema),
  linksController.create,
);
linkRoutes.get(
  "/",
  requirePermission("link", "read"),
  validateQuery(listLinksQuerySchema),
  linksController.list,
);
linkRoutes.get("/:id", requirePermission("link", "read"), linksController.get);
linkRoutes.delete("/:id", requirePermission("link", "delete"), linksController.remove);
```

- [ ] **Step 6: Implement the redirect module and v1 router, then wire the app**

`src/modules/redirect/redirect.service.ts`:
```ts
import { GoneError, NotFoundError } from "../../common/errors";
import type { RedirectMeta } from "../analytics/click-analytics";
import { clickRecorder, type ClickRecorder } from "../analytics/click-recorder";
import { isPossibleCode } from "../links/codes";
import { linkCache, type LinkCache } from "../links/link-cache";
import { linksRepository, type LinksRepository } from "../links/links.repository";

/** Resolves public short codes to destinations and records the click. */
export class RedirectService {
  constructor(
    private readonly repo: Pick<LinksRepository, "findByCode">,
    private readonly clicks: Pick<ClickRecorder, "enqueue">,
    private readonly cache: LinkCache = linkCache,
  ) {}

  /** 404 if unknown, 410 if expired; otherwise queues the click. */
  async resolve(code: string, meta: RedirectMeta): Promise<string> {
    // Skip the DB for paths that can't be codes (favicon.ico, /api/…, scans).
    if (!isPossibleCode(code)) throw new NotFoundError("Short link not found");
    let link = this.cache.get(code);
    if (!link) {
      const url = await this.repo.findByCode(code);
      if (!url) throw new NotFoundError("Short link not found");
      link = { id: url.id, originalUrl: url.originalUrl, expiresAt: url.expiresAt };
      this.cache.set(code, link);
    }
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new GoneError("Short link has expired");
    }
    this.clicks.enqueue(link.id, meta);
    return link.originalUrl;
  }
}

export const redirectService = new RedirectService(linksRepository, clickRecorder);
```

`src/modules/redirect/redirect.controller.ts`:
```ts
import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { redirectService } from "./redirect.service";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Public redirect handler. */
export const redirectController = {
  // GET /:code[/:channel] — the optional channel tag (`/abc1234/ig`) attributes
  // the click to a platform.
  redirect: asyncHandler(async (req: Request, res: Response) => {
    const q = req.query;
    const destination = await redirectService.resolve(req.params.code, {
      referer: req.get("referer") ?? undefined,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
      utmSource: str(q.utm_source),
      utmMedium: str(q.utm_medium),
      utmCampaign: str(q.utm_campaign),
      channel: req.params.channel,
      queryKeys: Object.keys(q),
    });
    res.redirect(302, destination);
  }),
};
```

`src/modules/redirect/redirect.routes.ts`:
```ts
import { Router } from "express";
import { limiter } from "../../common/middleware/rate-limit";
import { env } from "../../config/env";
import { redirectController } from "./redirect.controller";

/**
 * Public redirect: GET /:code[/:channel]. Own, much higher per-minute limit
 * (blunts code scanning without throttling real visitors). Mount last so it
 * never shadows API/health routes.
 */
export const redirectRoutes = Router();

redirectRoutes.get(
  "/:code/:channel?",
  limiter("redirect", 60_000, env.REDIRECT_RATE_LIMIT_MAX),
  redirectController.redirect,
);
```

`src/routes/v1.ts`:
```ts
import { Router } from "express";
import { requireAuth, requireOrganization } from "../modules/auth/auth.middleware";
import { linkRoutes } from "../modules/links/links.routes";

/**
 * Management API v1. Every route is authenticated and scoped to the caller's
 * active organization; each resource router adds its own permission checks.
 */
export const v1Routes = Router();

v1Routes.use(requireAuth, requireOrganization);
v1Routes.use("/links", linkRoutes);
```

In `src/app.ts`:
- Replace the `urlRoutes` and `urlController` imports with:
  ```ts
  import { v1Routes } from "./routes/v1";
  import { redirectRoutes } from "./modules/redirect/redirect.routes";
  ```
- Replace the `/api/urls` mount and the redirect `app.get(...)` block with:
  ```ts
  // Management API (strict limit), grouped by resource under /api/v1.
  app.use("/api/v1", limiter("api", env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX), v1Routes);

  // Public redirects. Kept last so they never shadow the routes above.
  app.use(redirectRoutes);
  ```

In `src/index.ts`, replace the two `modules/url` imports with:
```ts
import { analyticsRepository } from "./modules/analytics/analytics.repository";
import { clickRecorder } from "./modules/analytics/click-recorder";
```
and change `urlRepository.deleteClicksBefore` to `analyticsRepository.deleteClicksBefore`.

Delete the old module:
```bash
git rm -r src/modules/url
```

- [ ] **Step 7: Run tests, typecheck, lint and format**

Run: `bun run test && bun run typecheck && bun run lint && bun run format && bun run format:check`
Expected: all PASS. `tests/integration.test.ts` is skipped without `RUN_DB_TESTS` and is rewritten in Task 5. If `typecheck` flags it because it imports `src/modules/url/url.service`, change that import to `../src/modules/analytics/click-recorder` now.

- [ ] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "feat!: /api/v1/links with public ids and cursor pagination; split url module

BREAKING CHANGE: /api/urls is removed. Links are addressed by public id
(link_…), customAlias is now code, and lists use cursor pagination."
```

---

### Task 5: DB integration tests for v1

**Files:**
- Modify: `tests/integration.test.ts` (full rewrite)

**Interfaces:**
- Consumes:
  - `clickRecorder` from `src/modules/analytics/click-recorder`
  - `analyticsRepository.sourceBreakdown(urlId)`
  - `urls`, `member` from `src/db/schema`

- [ ] **Step 1: Rewrite `tests/integration.test.ts`**

```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { member, urls } from "../src/db/schema";
import { clickRecorder } from "../src/modules/analytics/click-recorder";
import { analyticsRepository } from "../src/modules/analytics/analytics.repository";

/** Signs up + signs in a fresh user; returns its bearer header and user id. */
async function newUser(app: ReturnType<typeof createApp>, prefix: string) {
  const creds = { email: `${prefix}${Date.now()}${Math.random()}@example.com`, password: "password123" };
  const signUp = await request(app).post("/api/auth/sign-up/email").send({ name: prefix, ...creds });
  expect(signUp.status).toBe(200);
  // Sign in again: the sign-up session predates the personal org.
  const signIn = await request(app).post("/api/auth/sign-in/email").send(creds);
  const token = signIn.headers["set-auth-token"] ?? signIn.body.token;
  expect(token).toBeTruthy();
  return { auth: { Authorization: `Bearer ${token}` }, userId: signUp.body.user.id as string, creds };
}

// Full stack against a migrated Postgres: RUN_DB_TESTS=1 DATABASE_URL=... bun run test
describe.skipIf(!process.env.RUN_DB_TESTS)("integration (Postgres)", () => {
  const app = createApp();
  let auth: { Authorization: string };

  afterAll(async () => {
    await clickRecorder.stop();
    await pool.end();
  });

  it("signs up and gets a bearer token", async () => {
    ({ auth } = await newUser(app, "owner"));
  });

  it("creates a link, reads it by id, redirects, and counts clicks", async () => {
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://example.com/landing" });
    expect(created.status).toBe(201);
    const { id, code } = created.body as { id: string; code: string };
    expect(id).toMatch(/^link_[0-9A-Za-z]{24}$/);
    expect(code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(created.headers.location).toBe(`/api/v1/links/${id}`);

    const hit = await request(app).get(`/${code}`).set("User-Agent", "Mozilla/5.0");
    expect(hit.status).toBe(302);
    expect(hit.headers.location).toBe("https://example.com/landing");

    await clickRecorder.stop(); // drain buffered clicks
    const read = await request(app).get(`/api/v1/links/${id}`).set(auth);
    expect(read.status).toBe(200);
    expect(read.body.clicks).toBe(1);
  });

  it("attributes one link's clicks per platform and ignores preview bots", async () => {
    const created = await request(app).post("/api/v1/links").set(auth).send({ url: "https://c.com" });
    const { id, code, shareUrls } = created.body as {
      id: string;
      code: string;
      shareUrls: Record<string, string>;
    };
    const path = (u: string) => new URL(u).pathname;
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1";
    const hits = [
      [path(shareUrls.instagram), iphone],
      [path(shareUrls.instagram), iphone],
      [path(shareUrls.linkedin), iphone],
      [`/${code}`, "Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 312.0.0.32.112"],
      [`/${code}`, "Twitterbot/1.0"],
      [path(shareUrls.x), "facebookexternalhit/1.1"],
    ];
    for (const [p, ua] of hits) {
      const res = await request(app).get(p).set("User-Agent", ua);
      expect(res.status).toBe(302);
    }

    await clickRecorder.stop();
    expect((await request(app).get(`/api/v1/links/${id}`).set(auth)).body.clicks).toBe(4);
    const [row] = await db.select({ id: urls.id }).from(urls).where(eq(urls.publicId, id));
    expect(await analyticsRepository.sourceBreakdown(row.id)).toEqual([
      { source: "instagram", method: "channel", clicks: 2 },
      { source: "instagram", method: "ua", clicks: 1 },
      { source: "linkedin", method: "channel", clicks: 1 },
    ]);
  });

  it("refuses a code equal to an existing link's code (no hijack)", async () => {
    const victim = await request(app).post("/api/v1/links").set(auth).send({ url: "https://a.com" });
    const squat = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://evil.com", code: victim.body.code });
    expect(squat.status).toBe(409);
    expect((await request(app).get(`/${victim.body.code}`)).headers.location).toBe("https://a.com");
  });

  it("rejects the legacy customAlias field", async () => {
    const res = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://a.com", customAlias: "legacy" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("customAlias");
  });

  it("pages through every link exactly once, even with identical created_at", async () => {
    const { auth: solo } = await newUser(app, "pager");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await request(app).post("/api/v1/links").set(solo).send({ url: `https://p${i}.com` })).body.id);
    }
    // Force a tie on the sort key: the tiebreaker must still order and page them.
    await db.update(urls).set({ createdAt: new Date("2026-01-01T00:00:00.000Z") }).where(eq(urls.publicId, ids[1]));
    await db.update(urls).set({ createdAt: new Date("2026-01-01T00:00:00.000Z") }).where(eq(urls.publicId, ids[2]));
    await db.update(urls).set({ createdAt: new Date("2026-01-01T00:00:00.000Z") }).where(eq(urls.publicId, ids[3]));

    for (const order of ["desc", "asc"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await request(app)
          .get("/api/v1/links")
          .query({ limit: 1, order, ...(cursor ? { cursor } : {}) })
          .set(solo);
        expect(res.status).toBe(200);
        seen.push(...(res.body.data as { id: string }[]).map((l) => l.id));
        cursor = res.body.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(ids));
    }
  });

  it("400s a garbage cursor instead of erroring in Postgres", async () => {
    const res = await request(app).get("/api/v1/links").query({ cursor: "garbage" }).set(auth);
    expect(res.status).toBe(400);
  });

  it("404s another organization's link and malformed ids", async () => {
    const { auth: other } = await newUser(app, "other");
    const mine = await request(app).post("/api/v1/links").set(auth).send({ url: "https://mine.com" });
    expect((await request(app).get(`/api/v1/links/${mine.body.id}`).set(other)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/links/${mine.body.id}`).set(other)).status).toBe(404);
    expect((await request(app).get("/api/v1/links/abc").set(auth)).status).toBe(404);
  });

  it("enforces membership on every request and member/admin delete rights", async () => {
    const session = await request(app).get("/api/auth/get-session").set(auth);
    const orgId = session.body.session.activeOrganizationId as string;
    const ownerLink = await request(app).post("/api/v1/links").set(auth).send({ url: "https://o.com" });

    // Second user joins the owner's org as a plain member and switches to it.
    const m = await newUser(app, "member");
    await db.insert(member).values({
      id: `mem-${Date.now()}`,
      organizationId: orgId,
      userId: m.userId,
      role: "member",
      createdAt: new Date(),
    });
    await request(app)
      .post("/api/auth/organization/set-active")
      .set(m.auth)
      .send({ organizationId: orgId })
      .expect(200);

    expect((await request(app).get("/api/v1/links").set(m.auth)).status).toBe(200);
    expect((await request(app).delete(`/api/v1/links/${ownerLink.body.id}`).set(m.auth)).status).toBe(403);
    const own = await request(app).post("/api/v1/links").set(m.auth).send({ url: "https://m.com" });
    expect((await request(app).delete(`/api/v1/links/${own.body.id}`).set(m.auth)).status).toBe(204);

    // Admin removes the member: their still-valid session loses access at once.
    await request(app)
      .post("/api/auth/organization/remove-member")
      .set(auth)
      .send({ memberIdOrEmail: m.creds.email, organizationId: orgId })
      .expect(200);
    expect((await request(app).get("/api/v1/links").set(m.auth)).status).toBe(403);
    expect((await request(app).post("/api/v1/links").set(m.auth).send({ url: "https://z.com" })).status).toBe(403);
  });

  it("stops redirecting after delete", async () => {
    const created = await request(app)
      .post("/api/v1/links")
      .set(auth)
      .send({ url: "https://b.com", code: `gone-${Date.now()}` });
    const { id, code } = created.body as { id: string; code: string };
    expect((await request(app).get(`/${code}`)).status).toBe(302);
    expect((await request(app).delete(`/api/v1/links/${id}`).set(auth)).status).toBe(204);
    expect((await request(app).get(`/${code}`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run against Postgres**

Run:
```bash
docker compose up -d && bun run db:migrate && RUN_DB_TESTS=1 bun run test tests/integration.test.ts
```
(`.env` must point `DATABASE_URL` at `localhost:5433`.)
Expected: all integration tests PASS. If the pagination test fails, the keyset comparison or tiebreaker is wrong. Fix `LinksRepository.list`, not the test.

- [ ] **Step 3: Run the full suite, format and commit**

```bash
bun run test && bun run format && bun run lint
git add tests/integration.test.ts
git commit -m "test: v1 links integration coverage (keyset ties, cross-org 404, membership)"
```

---

### Task 6: Docs and API collections

**Files:**
- Delete: `docs/api/url.md`
- Create: `docs/api/links.md`
- Modify: `README.md` (API section, architecture tree), `docs/frontend-spec.md` (route references), `url-shortener.postman_collection.json`
- Bruno: rename `bruno/URLs/` → `bruno/Links/` and rewrite the request files

- [ ] **Step 1: Write `docs/api/links.md`**

````markdown
# Links API (v1)

All routes require `Authorization: Bearer <session token>` and act on the
session's active organization. Errors use `{ "error": { "code", "message" } }`.

## Resource

```json
{
  "id": "link_8fK2mQ9xLr0aTzW3bN7cYv1D",
  "code": "abc1234",
  "shortUrl": "http://localhost:3000/abc1234",
  "url": "https://example.com/landing",
  "shareUrls": { "instagram": "http://localhost:3000/abc1234/ig", "...": "..." },
  "clicks": 0,
  "createdBy": "<user id>",
  "expiresAt": null,
  "createdAt": "2026-10-08T10:00:00.123Z"
}
```

`id` is permanent. `code` is the path segment of the short URL.

## Endpoints

| Method | Path | Permission | Success |
| ------ | ---- | ---------- | ------- |
| POST | `/api/v1/links` | link:create | `201` + `Location` |
| GET | `/api/v1/links` | link:read | `200` page |
| GET | `/api/v1/links/:id` | link:read | `200` |
| DELETE | `/api/v1/links/:id` | link:delete | `204` |

### POST /api/v1/links

```json
{ "url": "https://example.com", "code": "promo", "expiresAt": "2030-01-01T00:00:00Z" }
```

- `url`: http(s) only, ≤2048 chars, no embedded credentials, not this
  shortener, and passes Safe Browsing when configured.
- `code` (optional): 3–32 chars `A–Z a–z 0–9 _ -`. Reserved words are rejected
  (`409`), and a code already in use returns `409`.
- `expiresAt` (optional): a future ISO date. An expired link returns `410`.
- Unknown fields are rejected with `400`.

### GET /api/v1/links

| Query | Default | Notes |
| ----- | ------- | ----- |
| `limit` | 20 | 1–100 |
| `sort` | `createdAt` | `createdAt` or `clicks` |
| `order` | `desc` | `asc` or `desc` |
| `cursor` | — | `nextCursor` from the previous page |

```json
{ "data": [ /* links */ ], "nextCursor": "eyJrIjoi…" }
```

`nextCursor` is `null` on the last page. Cursors are opaque, and a malformed
one returns `400`.

### DELETE /api/v1/links/:id

Owners and admins can delete any link. Members can delete only links they
created (`403` otherwise). A link in another organization, or an unknown id,
returns `404`.

## Redirect

`GET /:code` and `GET /:code/:channel` → `302` to `url`. Returns `404` when
unknown and `410` when expired.
````

```bash
git rm docs/api/url.md
```

- [ ] **Step 2: Update `README.md`**

- In the "🧱 Architecture" tree, replace the `url/` line with:
```
    analytics/             # attribution, click parsing, batched recorder, click repo
    links/                 # /api/v1/links: repository, service, schema, routes, codes, cache
    redirect/              # public GET /:code[/:channel]
  routes/v1.ts             # mounts /api/v1 resource groups behind auth + org guards
```
- Replace the "### URLs" table and the curl example with:
```markdown
### Links (v1)

See [docs/api/links.md](docs/api/links.md).

| Method | Path                | Description                         |
| ------ | ------------------- | ----------------------------------- |
| POST   | `/api/v1/links`     | Create a link (`url`, `code?`, `expiresAt?`) |
| GET    | `/api/v1/links`     | List (cursor: `limit`, `cursor`, `sort`, `order`) |
| GET    | `/api/v1/links/:id` | Read one link                       |
| DELETE | `/api/v1/links/:id` | Soft-delete                         |
| GET    | `/:code[/:channel]` | Redirect (302); 410 if expired      |
```
- In the curl example, change `POST localhost:3000/api/urls` to `/api/v1/links`.
- In the "Per-platform attribution" section, change the reference to `GET /api/urls/:code/stats`. Per-source stats return in phase D (`GET /api/v1/analytics?groupBy=sources`), so say exactly that.

- [ ] **Step 3: Update `docs/frontend-spec.md`**

Run: `grep -n "api/urls\|customAlias\|offset" docs/frontend-spec.md`
For every hit:
- `/api/urls` becomes `/api/v1/links`.
- `:code` path params become `:id`.
- `customAlias` becomes `code`.
- `offset`/`total` pagination becomes `cursor`/`nextCursor`.
- `/stats` usages get a note "(analytics endpoint arrives in phase D)".

- [ ] **Step 4: Rewrite the Bruno folder**

```bash
git mv bruno/URLs bruno/Links
git rm "bruno/Links/URL Stats.bru"
git mv "bruno/Links/Create Short URL.bru" "bruno/Links/Create Link.bru"
git mv "bruno/Links/Create Short URL (custom alias and expiry).bru" "bruno/Links/Create Link (custom code and expiry).bru"
git mv "bruno/Links/List Org URLs.bru" "bruno/Links/List Links.bru"
git mv "bruno/Links/Delete Short URL.bru" "bruno/Links/Delete Link.bru"
```
Edit `bruno/Links/folder.bru` and set the folder name to `Links`.

In all three `Redirect*.bru` files, nothing changes except the folder; they still use `{{shortCode}}`.

`bruno/Links/Create Link.bru`:
```
meta {
  name: Create Link
  type: http
  seq: 1
}

post {
  url: {{baseUrl}}/api/v1/links
  body: json
  auth: bearer
}

auth:bearer {
  token: {{sessionToken}}
}

body:json {
  {
    "url": "https://aiengg.dev"
  }
}

tests {
  test('201 Created', () => expect(res.getStatus()).to.equal(201));
  try {
    const data = res.getBody();
    test('public id', () => expect(data.id).to.match(/^link_[0-9A-Za-z]{24}$/));
    test('Location header', () => expect(res.getHeader('location')).to.equal('/api/v1/links/' + data.id));
    test('shortUrl contains code', () => expect(data.shortUrl).to.include(data.code));
    test('shareUrls per channel', () => expect(data.shareUrls.instagram).to.equal(data.shortUrl + '/ig'));
    if (data.id) bru.setVar('linkId', data.id);
    if (data.code) bru.setVar('shortCode', data.code);
  } catch (e) {}
}

docs {
  Creates a link in the active organization. Optional: code (3-32 chars), expiresAt (future ISO date).
}
```

`bruno/Links/Create Link (custom code and expiry).bru`: same as above, but with `seq: 2`, the name `Create Link (custom code and expiry)`, and this body. Keep the same tests except the `bru.setVar` lines:
```json
{
  "url": "https://aiengg.dev/blog",
  "code": "blog-{{$timestamp}}",
  "expiresAt": "2030-01-01T00:00:00Z"
}
```

`bruno/Links/List Links.bru`:
```
meta {
  name: List Links
  type: http
  seq: 3
}

get {
  url: {{baseUrl}}/api/v1/links?limit=20&sort=createdAt&order=desc
  body: none
  auth: bearer
}

params:query {
  limit: 20
  sort: createdAt
  order: desc
}

auth:bearer {
  token: {{sessionToken}}
}

tests {
  test('200 OK', () => expect(res.getStatus()).to.equal(200));
  try {
    const data = res.getBody();
    test('data array', () => expect(data.data).to.be.an('array'));
    test('nextCursor present', () => expect(data).to.have.property('nextCursor'));
  } catch (e) {}
}

docs {
  One keyset page. Pass ?cursor=<nextCursor> for the next page; nextCursor is null on the last page.
}
```

`bruno/Links/Get Link.bru` (new):
```
meta {
  name: Get Link
  type: http
  seq: 4
}

get {
  url: {{baseUrl}}/api/v1/links/{{linkId}}
  body: none
  auth: bearer
}

auth:bearer {
  token: {{sessionToken}}
}

tests {
  test('200 OK', () => expect(res.getStatus()).to.equal(200));
  test('same id', () => expect(res.getBody().id).to.equal(bru.getVar('linkId')));
}
```

`bruno/Links/Delete Link.bru`: set the URL to `{{baseUrl}}/api/v1/links/{{linkId}}`, the name to `Delete Link`, and keep its `204` test.

- [ ] **Step 5: Update the Postman collection**

Run this one-off script:
```bash
python3 - <<'PY'
import json
p = "url-shortener.postman_collection.json"
c = json.load(open(p))
folder = next(i for i in c["item"] if i["name"] == "URLs")
folder["name"] = "Links"

def req(name, method, path, body=None, tests=()):
    r = {
        "name": name,
        "event": [{"listen": "test", "script": {"type": "text/javascript", "exec": list(tests)}}],
        "request": {
            "method": method,
            "header": [{"key": "Content-Type", "value": "application/json"}] if body else [],
            "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{sessionToken}}", "type": "string"}]},
            "url": {"raw": "{{baseUrl}}" + path, "host": ["{{baseUrl}}"],
                    "path": [s for s in path.split("?")[0].split("/") if s]},
        },
    }
    if "?" in path:
        r["request"]["url"]["query"] = [dict(zip(("key", "value"), kv.split("="))) for kv in path.split("?")[1].split("&")]
    if body is not None:
        r["request"]["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2)}
    return r

redirect = next(i for i in folder["item"] if i["name"].startswith("Redirect"))
folder["item"] = [
    req("Create Link", "POST", "/api/v1/links", {"url": "https://aiengg.dev"}, [
        "pm.test('201', () => pm.response.to.have.status(201));",
        "const d = pm.response.json();",
        "pm.collectionVariables.set('linkId', d.id);",
        "pm.collectionVariables.set('shortCode', d.code);",
    ]),
    req("List Links", "GET", "/api/v1/links?limit=20&sort=createdAt&order=desc", None, [
        "pm.test('200', () => pm.response.to.have.status(200));",
        "pm.test('page shape', () => { const d = pm.response.json(); pm.expect(d.data).to.be.an('array'); pm.expect(d).to.have.property('nextCursor'); });",
    ]),
    req("Get Link", "GET", "/api/v1/links/{{linkId}}", None, [
        "pm.test('200', () => pm.response.to.have.status(200));",
    ]),
    redirect,
    req("Delete Link", "DELETE", "/api/v1/links/{{linkId}}", None, [
        "pm.test('204', () => pm.response.to.have.status(204));",
    ]),
]
json.dump(c, open(p, "w"), indent=2)
open(p, "a").write("\n")
PY
```

- [ ] **Step 6: Verify the collections end to end**

Run (server up, fresh email; see the README note on `AUTH_RATE_LIMIT_MAX`):
```bash
bun run dev &
npx @usebruno/cli run --env Local --env-var email=me+$(date +%s)@example.com
```
Expected: every request in `Links/` passes. Stop the dev server afterwards.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add -A README.md docs url-shortener.postman_collection.json bruno
git commit -m "docs: v1 links API reference, README, Postman and Bruno collections"
```

---

## Phase A done when

- `bun run test && bun run typecheck && bun run lint && bun run format:check` passes.
- `RUN_DB_TESTS=1 bun run test tests/integration.test.ts` passes against Docker Postgres + Redis.
- `grep -rn "api/urls\|modules/url" src tests docs bruno README.md` returns nothing, apart from the historical spec and plan.
