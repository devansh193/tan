# Phase B — Link Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let links be edited after creation and give them the fields a real shortener needs:

- title and description
- a 301 or 302 redirect
- UTM parameters via a builder
- search, and filtering by creator

Redirects must reflect edits across every instance immediately, send noindex headers, and stay fast at scale.

**Architecture:**

- **Data:** `urls` gains `title`, `description`, `redirect_type` and `updated_at`, plus `pg_trgm` search indexes.
- **UTM:** the destination URL stays the single source of truth for UTM values. A small `utm.ts` merges values into it and reads them back.
- **Redirect lookups** go through a new `LinkStore`:
  - Lookup order: in-process LRU (L1), then Redis (L2), then Postgres.
  - "Not found" results are cached briefly.
  - After create, update or delete, the store deletes the code's L1 and L2 entries and publishes the codes on Redis pub/sub so other instances drop their L1 entries.
  - A delayed second delete covers the read/write race.
- **Redirect responses** use the link's own status (301 or 302) with a matching `Cache-Control`, plus `X-Robots-Tag`.

**Tech Stack:** Bun, TypeScript, Express 4, Drizzle ORM 0.36 (Postgres 16 + `pg_trgm`), node-redis 6, Zod, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-10-08-link-platform-v1-design.md` (§3 link resource and create/update body, §5 redirect path, §6 `urls` columns and indexes, §11-B). Tags (`tagIds`) are phase C and are not part of this plan.

## Global Constraints

- **PATCH:** `/api/v1/links/:id` uses JSON merge semantics. An omitted field is unchanged; `null` clears `title`, `description` or `expiresAt`. An empty body or unknown keys return 400.
- **Body limits:**
  - `title` ≤200 chars, `description` ≤1000 (trimmed, non-empty).
  - `redirectType` is `301` or `302` (default 302).
  - `utm` keys are `source`, `medium`, `campaign`, `term` and `content`, each ≤200 chars or `null`.
- **UTM:** the destination URL is the only store. `utm` sets or removes `utm_*` params and leaves every other param byte-for-byte unchanged. The final URL must be ≤2048 chars.
- **Permissions:**
  - PATCH requires `link:update`.
  - Members may edit only links they created; owners and admins may edit any.
  - Another org's link or a malformed id returns 404.
- **Code changes:** the old code is freed immediately. Both old and new codes are invalidated.
- **Redirect headers:**
  - 302 sends `Cache-Control: private, max-age=0`.
  - 301 sends `Cache-Control: private, max-age=3600`.
  - Every response on the redirect route (302/301/404/410/429) sends `X-Robots-Tag: noindex, nofollow`.
- **robots.txt:** `GET /robots.txt` returns `User-agent: *\nDisallow: /api/\n`. This is the user's decision, recorded in the spec: short links must stay crawlable so preview bots work and see noindex.
- **Cache TTLs:** L1 30 s (hits and misses). L2 `link:{code}` 1 h for hits, 30 s for misses. Pub/sub channel `link:invalidate`, payload a JSON array of codes. A second invalidation runs 1 s after the first.
- **Redis is optional:** without `REDIS_URL` the store is L1 only. Any Redis error fails open: the lookup falls through to Postgres and is logged, never a 5xx.
- **List filters:** `GET /api/v1/links` gains `q` (1–100 chars, matched case-insensitively against code, title or URL, with `%`/`_` matched literally) and `userId`. Both work with every sort and with cursors.
- **Code style:** follow the existing code: doc comment on each export, class plus singleton, `asyncHandler`, Prettier. Run `npx prettier --write <files you changed>`, not `bun run format`, which rewrites unrelated user files.
- **DB tests:** run against the `url_shortener_test` database:
  ```bash
  RUN_DB_TESTS=1 AUTH_RATE_LIMIT_MAX=10000 RATE_LIMIT_MAX=10000 DATABASE_URL=postgresql://postgres:postgres@localhost:5433/url_shortener_test REDIS_URL=redis://localhost:6380 bun run test
  ```
  Migrate that database first with `DATABASE_URL=… BETTER_AUTH_SECRET=01234567890123456789012345678901 bun run db:migrate`.

## Review Focus

1. **`PATCH {"expiresAt": null}` must clear the expiry.** `z.coerce.date()` turns `null` into 1970-01-01, which would 400 ("must be in the future") instead of clearing. Tested in Task 5 (schema) and Task 6 (DB).
2. **A code requested before it existed** (cached as not found) must resolve as soon as a link is created or renamed to it, not 30 s later. Tested in Task 3 (store) and Task 6 (DB).
3. **UTM edits must leave other query params byte-for-byte unchanged** (`a=b%20c`, `x=1&x=2`, a fragment). Otherwise the destination changes in ways the user didn't ask for. Tested in Task 1.
4. **Search text containing `%`, `_` or `\`** is matched literally. `q=%` must not match every link. Tested in Task 6.
5. **Redis down or misbehaving during a redirect** (GET throws, or holds garbage JSON) must still redirect from Postgres, never 500. Tested in Task 3.

---

## File map

| File                                                                                                        | Responsibility                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/links/utm.ts` (new)                                                                            | `applyUtm`, `readUtm`, UTM key list                                                                                                                                                                             |
| `src/db/schema.ts` + `drizzle/0007_link_core.sql` (new)                                                     | New `urls` columns, check constraint, `pg_trgm` and creator indexes                                                                                                                                             |
| `src/modules/links/link-cache.ts` (modify)                                                                  | L1 LRU now also stores misses (`null`); new `redirectType` field; singleton removed                                                                                                                             |
| `src/modules/links/link-store.ts` (new)                                                                     | L1 → L2 → DB lookup, invalidation, pub/sub subscriber, `linkStore` singleton                                                                                                                                    |
| `src/modules/redirect/{redirect.service,redirect.controller,redirect.routes}.ts` (modify)                   | Status per link, `Cache-Control`, `X-Robots-Tag`, `robots.txt`                                                                                                                                                  |
| `src/modules/links/{links.schema,links.repository,links.service,links.controller,links.routes}.ts` (modify) | Create extras, PATCH, search and creator filters, new view fields, store invalidation                                                                                                                           |
| `src/index.ts` (modify)                                                                                     | Start and stop the subscriber                                                                                                                                                                                   |
| Tests                                                                                                       | `tests/utm.test.ts`, `tests/link-store.test.ts` (new); `tests/links.schema.test.ts`, `tests/links.service.test.ts`, `tests/redirect.service.test.ts`, `tests/app.test.ts`, `tests/integration.test.ts` (modify) |
| Docs                                                                                                        | `docs/api/links.md`, `README.md`, `docs/frontend-spec.md`, `bruno/Links/Update Link.bru` (new), `url-shortener.postman_collection.json`                                                                         |

---

### Task 1: UTM helpers

**Files:**

- Create: `src/modules/links/utm.ts`
- Test: `tests/utm.test.ts`

**Interfaces:**

- Produces:
  - `UTM_KEYS: readonly ["source","medium","campaign","term","content"]`
  - `type UtmKey`
  - `type Utm = Record<UtmKey, string | null>`
  - `type UtmPatch = Partial<Record<UtmKey, string | null>>`
  - `applyUtm(url: string, patch: UtmPatch): string`
  - `readUtm(url: string): Utm`

- [ ] **Step 1: Write the failing test** — `tests/utm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyUtm, readUtm } from "../src/modules/links/utm";

describe("applyUtm", () => {
  it("adds utm params", () => {
    expect(applyUtm("https://a.com/p", { source: "x", medium: "social" })).toBe(
      "https://a.com/p?utm_source=x&utm_medium=social",
    );
  });

  it("replaces and removes only the keys given", () => {
    const url = "https://a.com/p?utm_source=old&utm_medium=email&a=1";
    expect(applyUtm(url, { source: "new", medium: null })).toBe(
      "https://a.com/p?a=1&utm_source=new",
    );
  });

  it("leaves other params byte-for-byte and keeps the fragment", () => {
    const url = "https://a.com/p?a=b%20c&x=1&x=2&q=a+b#frag";
    expect(applyUtm(url, { campaign: "launch day" })).toBe(
      "https://a.com/p?a=b%20c&x=1&x=2&q=a+b&utm_campaign=launch%20day#frag",
    );
  });

  it("drops the query entirely when the last param is removed", () => {
    expect(applyUtm("https://a.com/p?utm_source=x", { source: null })).toBe("https://a.com/p");
  });

  it("is a no-op for an empty patch", () => {
    expect(applyUtm("https://a.com/p?a=1", {})).toBe("https://a.com/p?a=1");
  });
});

describe("readUtm", () => {
  it("reads all five keys, null when absent, decoded", () => {
    expect(readUtm("https://a.com/?utm_source=x&utm_campaign=launch%20day")).toEqual({
      source: "x",
      medium: null,
      campaign: "launch day",
      term: null,
      content: null,
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `bun run test tests/utm.test.ts`. Expected: FAIL, because `../src/modules/links/utm` can't be resolved.

- [ ] **Step 3: Implement** — `src/modules/links/utm.ts`:

```ts
/** The five standard campaign parameters, stored on the destination URL as `utm_*`. */
export const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Record<UtmKey, string | null>;
/** A string sets the param, `null` removes it, an absent key leaves it alone. */
export type UtmPatch = Partial<Record<UtmKey, string | null>>;

const paramName = (pair: string): string => {
  const raw = pair.split("=", 1)[0].replace(/\+/g, " ");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * Applies a UTM patch to a URL. Other query params are kept byte-for-byte (no
 * re-encoding), so the destination never changes in ways the user didn't ask
 * for; patched `utm_*` params move to the end.
 */
export const applyUtm = (url: string, patch: UtmPatch): string => {
  const touched = UTM_KEYS.filter((k) => k in patch);
  if (!touched.length) return url;
  const names = new Set(touched.map((k) => `utm_${k}`));
  const u = new URL(url);
  const kept = u.search
    .slice(1)
    .split("&")
    .filter((pair) => pair && !names.has(paramName(pair)));
  const added = touched.flatMap((k) => {
    const value = patch[k];
    return value == null ? [] : [`utm_${k}=${encodeURIComponent(value)}`];
  });
  const query = [...kept, ...added].join("&");
  const base = url.split(/[?#]/, 1)[0];
  return `${base}${query ? `?${query}` : ""}${u.hash}`;
};

/** The UTM values on a URL (decoded), `null` where absent. */
export const readUtm = (url: string): Utm => {
  const params = new URL(url).searchParams;
  return Object.fromEntries(UTM_KEYS.map((k) => [k, params.get(`utm_${k}`)])) as Utm;
};
```

`base` is taken from the original string rather than the `URL` object, so a bare host like `https://a.com` is not rewritten to `https://a.com/`.

- [ ] **Step 4: Run the test.** Run: `bun run test tests/utm.test.ts`. Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/links/utm.ts tests/utm.test.ts
git commit -m "feat: UTM builder helpers that preserve other query params"
```

---

### Task 2: Schema — title, description, redirect type, updated_at, search indexes

**Files:**

- Modify: `src/db/schema.ts`
- Create: `drizzle/0007_link_core.sql` (generated, then edited) + its snapshot and journal entry

**Interfaces:**

- Produces: `Url` gains `title: string | null`, `description: string | null`, `redirectType: number`, `updatedAt: Date`.

- [ ] **Step 1: Edit `urls` in `src/db/schema.ts`**

Add `check` and `smallint` to the `drizzle-orm/pg-core` import, and `sql` from `drizzle-orm`. After `code`, add:

```ts
    title: text("title"),
    description: text("description"),
    // 301 (permanent) or 302 (temporary, default) — see redirect.controller.ts.
    redirectType: smallint("redirect_type").notNull().default(302),
```

After `createdAt`, add:

```ts
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
```

Append these to the index list:

```ts
    // List filter by creator.
    index("urls_org_user_created_idx").on(t.organizationId, t.userId, t.createdAt),
    // `q` search: trigram indexes make ILIKE '%…%' an index scan.
    index("urls_code_trgm_idx").using("gin", t.code.op("gin_trgm_ops")),
    index("urls_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("urls_original_url_trgm_idx").using("gin", t.originalUrl.op("gin_trgm_ops")),
    check("urls_redirect_type_check", sql`${t.redirectType} IN (301, 302)`),
```

- [ ] **Step 2: Generate the migration.** Run: `bun run db:generate --name link_core`. Expected: `drizzle/0007_link_core.sql` is created.

- [ ] **Step 3: Make the extension the first statement.** Prepend this line to `drizzle/0007_link_core.sql`, since the trigram indexes need it:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
```

The file should then contain, in some order:

- the 4 `ADD COLUMN`s (`title`, `description`, `redirect_type` defaulting to 302, `updated_at` defaulting to now)
- the check constraint
- the 4 `CREATE INDEX` statements, 3 of them `USING gin (… gin_trgm_ops)`

`ADD COLUMN … NOT NULL DEFAULT` is safe on existing rows, so no backfill is needed. If drizzle-kit writes the `updated_at` default as anything other than `now()`, change it to `now()`.

- [ ] **Step 4: Apply to both databases and verify**

```bash
bun run db:migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/url_shortener_test BETTER_AUTH_SECRET=01234567890123456789012345678901 bun run db:migrate
docker compose exec -T postgres psql -U postgres -d url_shortener -c "SELECT count(*) FILTER (WHERE redirect_type = 302) AS r302, count(*) AS total FROM urls; SELECT indexname FROM pg_indexes WHERE tablename='urls' ORDER BY 1;"
```

Expected: `r302 = total`, and the index list includes `urls_code_trgm_idx`, `urls_title_trgm_idx`, `urls_original_url_trgm_idx` and `urls_org_user_created_idx`.

- [ ] **Step 5: Commit.** Running `bun run typecheck` here shows errors only in test fixtures that build `Url` objects; Task 3 and Task 5 fix those.

```bash
git add src/db/schema.ts drizzle
git commit -m "feat(db): link title, description, redirect type, updated_at, trigram search"
```

---

### Task 3: Two-level link store with cross-instance invalidation

**Files:**

- Modify: `src/modules/links/link-cache.ts`
- Create: `src/modules/links/link-store.ts`
- Modify: `src/index.ts` (start and stop the subscriber)
- Test: `tests/link-store.test.ts`

**Interfaces:**

- Consumes: `LinksRepository.findByCode(code): Promise<Url | undefined>`, `redis` from `src/lib/redis.ts`.
- Produces:
  - `CachedLink { id: number; originalUrl: string; expiresAt: Date | null; redirectType: 301 | 302 }`
  - `LinkCache`:
    - `get(code): CachedLink | null | undefined` (`undefined` means no entry, `null` means known missing)
    - `set(code, link: CachedLink | null)`
    - `delete(code)`
  - `type RedisLike` (the subset of the client the store uses)
  - `LinkStore`:
    - `constructor(repo, redis: RedisLike | null, l1 = new LinkCache(), redelayMs = 1000)`
    - `get(code): Promise<CachedLink | null>`
    - `invalidate(codes: string[]): Promise<void>`
    - `start(): Promise<void>`, `stop(): Promise<void>`
  - `linkStore` (singleton)
- Removes: the `linkCache` singleton (callers move to `linkStore`).

- [ ] **Step 1: Write the failing test** — `tests/link-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinkStore, type RedisLike } from "../src/modules/links/link-store";
import type { Url } from "../src/db/schema";

const row = (over: Partial<Url> = {}): Url => ({
  id: 7,
  publicId: "link_AAAAAAAAAAAAAAAAAAAAAAAA",
  code: "abc1234",
  title: null,
  description: null,
  redirectType: 301,
  originalUrl: "https://example.com",
  organizationId: "org-1",
  userId: "user-1",
  clickCount: 0,
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

/** In-memory stand-in for the node-redis client surface the store uses. */
const fakeRedis = () => {
  const kv = new Map<string, string>();
  const published: string[] = [];
  const r = {
    kv,
    published,
    get: vi.fn(async (k: string) => kv.get(k) ?? null),
    del: vi.fn(async (keys: string[]) => keys.forEach((k) => kv.delete(k))),
    publish: vi.fn(async (_c: string, msg: string) => void published.push(msg)),
    sendCommand: vi.fn(async (args: string[]) => {
      kv.set(args[1], args[2]); // SET key value EX ttl
      return "OK";
    }),
    duplicate: vi.fn(),
  };
  return r;
};

let repo: { findByCode: ReturnType<typeof vi.fn> };
beforeEach(() => {
  repo = { findByCode: vi.fn() };
});

describe("LinkStore without Redis", () => {
  it("reads through to the DB once, then serves from L1", async () => {
    repo.findByCode.mockResolvedValue(row());
    const store = new LinkStore(repo, null);
    const link = await store.get("abc1234");
    expect(link).toEqual({
      id: 7,
      originalUrl: "https://example.com",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      redirectType: 301,
    });
    await store.get("abc1234");
    expect(repo.findByCode).toHaveBeenCalledOnce();
  });

  it("caches misses, and invalidate makes a newly created code resolvable at once", async () => {
    repo.findByCode.mockResolvedValue(undefined);
    const store = new LinkStore(repo, null);
    expect(await store.get("promo")).toBeNull();
    expect(await store.get("promo")).toBeNull();
    expect(repo.findByCode).toHaveBeenCalledOnce();

    repo.findByCode.mockResolvedValue(row({ code: "promo" }));
    await store.invalidate(["promo"]);
    expect((await store.get("promo"))?.id).toBe(7);
  });
});

describe("LinkStore with Redis", () => {
  it("writes hits to L2 for 1h and misses for 30s", async () => {
    const redis = fakeRedis();
    repo.findByCode.mockResolvedValueOnce(row()).mockResolvedValueOnce(undefined);
    const store = new LinkStore(repo, redis as unknown as RedisLike);
    await store.get("abc1234");
    await store.get("nope");
    await vi.waitFor(() => expect(redis.sendCommand).toHaveBeenCalledTimes(2));
    expect(redis.sendCommand.mock.calls[0][0]).toEqual([
      "SET",
      "link:abc1234",
      expect.any(String),
      "EX",
      "3600",
    ]);
    expect(redis.sendCommand.mock.calls[1][0]).toEqual([
      "SET",
      "link:nope",
      '{"missing":true}',
      "EX",
      "30",
    ]);
  });

  it("serves L2 hits without the DB, restoring dates", async () => {
    const redis = fakeRedis();
    redis.kv.set(
      "link:abc1234",
      JSON.stringify({
        id: 7,
        url: "https://l2.com",
        expiresAt: "2030-01-01T00:00:00.000Z",
        redirectType: 302,
      }),
    );
    const store = new LinkStore(repo, redis as unknown as RedisLike);
    const link = await store.get("abc1234");
    expect(link).toEqual({
      id: 7,
      originalUrl: "https://l2.com",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      redirectType: 302,
    });
    expect(repo.findByCode).not.toHaveBeenCalled();
  });

  it("invalidate drops L1, deletes L2, publishes, and repeats after the delay", async () => {
    vi.useFakeTimers();
    try {
      const redis = fakeRedis();
      repo.findByCode.mockResolvedValue(row());
      const store = new LinkStore(repo, redis as unknown as RedisLike, undefined, 1000);
      await store.get("abc1234");
      await store.invalidate(["abc1234", "new1"]);
      expect(redis.del).toHaveBeenCalledWith(["link:abc1234", "link:new1"]);
      expect(redis.published).toEqual(['["abc1234","new1"]']);
      await vi.advanceTimersByTimeAsync(1000);
      expect(redis.del).toHaveBeenCalledTimes(2);
      expect(redis.published).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails open when Redis errors or holds garbage", async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValueOnce(new Error("down"));
    repo.findByCode.mockResolvedValue(row());
    const store = new LinkStore(repo, redis as unknown as RedisLike);
    expect((await store.get("abc1234"))?.id).toBe(7);

    const store2 = new LinkStore(repo, redis as unknown as RedisLike);
    redis.kv.set("link:abc1234", "{not json");
    expect((await store2.get("abc1234"))?.id).toBe(7);

    redis.del.mockRejectedValueOnce(new Error("down"));
    await expect(store.invalidate(["abc1234"])).resolves.toBeUndefined();
  });

  it("drops L1 entries when another instance publishes an invalidation", async () => {
    const redis = fakeRedis();
    let listener: (msg: string) => void = () => {};
    const sub = {
      on: vi.fn(),
      connect: vi.fn(async () => {}),
      subscribe: vi.fn(async (_c: string, l: (msg: string) => void) => void (listener = l)),
      quit: vi.fn(async () => {}),
    };
    redis.duplicate.mockReturnValue(sub);
    repo.findByCode.mockResolvedValue(row());
    const store = new LinkStore(repo, redis as unknown as RedisLike);
    await store.start();
    await store.get("abc1234");
    listener('["abc1234"]');
    redis.kv.clear();
    await store.get("abc1234");
    expect(repo.findByCode).toHaveBeenCalledTimes(2);
    listener("garbage"); // ignored, no throw
    await store.stop();
    expect(sub.quit).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `bun run test tests/link-store.test.ts`. Expected: FAIL, because `../src/modules/links/link-store` can't be resolved.

- [ ] **Step 3: Implement**

Replace `src/modules/links/link-cache.ts` with:

```ts
/** The fields a redirect needs. */
export interface CachedLink {
  id: number;
  originalUrl: string;
  expiresAt: Date | null;
  redirectType: 301 | 302;
}

const TTL_MS = 30_000;
const MAX_ENTRIES = 50_000;

/**
 * In-process LRU + TTL cache (L1) for redirect lookups. Stores misses as
 * `null` so code scans don't reach Redis or the DB; `get` returns `undefined`
 * when there is no entry at all.
 */
export class LinkCache {
  private readonly entries = new Map<string, { link: CachedLink | null; until: number }>();

  get(code: string): CachedLink | null | undefined {
    const hit = this.entries.get(code);
    if (!hit) return undefined;
    this.entries.delete(code);
    if (hit.until < Date.now()) return undefined;
    this.entries.set(code, hit); // re-insert = most recently used
    return hit.link;
  }

  set(code: string, link: CachedLink | null): void {
    this.entries.delete(code);
    this.entries.set(code, { link, until: Date.now() + TTL_MS });
    if (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  delete(code: string): void {
    this.entries.delete(code);
  }
}
```

`src/modules/links/link-store.ts`:

```ts
import { logger } from "../../common/logger";
import { redis as sharedRedis } from "../../lib/redis";
import { LinkCache, type CachedLink } from "./link-cache";
import { linksRepository, type LinksRepository } from "./links.repository";

const HIT_TTL_S = 3600;
const MISS_TTL_S = 30;
const CHANNEL = "link:invalidate";
const keyOf = (code: string) => `link:${code}`;

type Subscriber = {
  on(event: "error", listener: (err: unknown) => void): unknown;
  connect(): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  quit(): Promise<unknown>;
};

/** The node-redis surface this store uses (narrow, so tests can fake it). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  del(keys: string[]): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  sendCommand(args: string[]): Promise<unknown>;
  duplicate(): Subscriber;
}

type Stored =
  | { id: number; url: string; expiresAt: string | null; redirectType: 301 | 302 }
  | { missing: true };

const parseCodes = (message: string): string[] => {
  try {
    const codes: unknown = JSON.parse(message);
    return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
};

/**
 * Redirect lookups: in-process LRU (L1) → Redis (L2) → Postgres, with short
 * negative caching. Writers call `invalidate` after a change commits: it drops
 * the codes from L1 and L2 and publishes them so every instance drops its L1.
 * Redis is optional and every Redis failure falls through to Postgres.
 *
 * ponytail: a reader that loaded the old row just before an update can write it
 * back to L2 after the DEL; the second invalidation 1 s later closes that
 * window. A versioned key would close it fully if it ever matters.
 */
export class LinkStore {
  private subscriber: Subscriber | null = null;

  constructor(
    private readonly repo: Pick<LinksRepository, "findByCode">,
    private readonly redis: RedisLike | null,
    private readonly l1 = new LinkCache(),
    private readonly redelayMs = 1000,
  ) {}

  /** The link behind `code`, or null if there is none. */
  async get(code: string): Promise<CachedLink | null> {
    const cached = this.l1.get(code);
    if (cached !== undefined) return cached;

    const fromL2 = await this.readL2(code);
    if (fromL2 !== undefined) {
      this.l1.set(code, fromL2);
      return fromL2;
    }

    const row = await this.repo.findByCode(code);
    const link: CachedLink | null = row
      ? {
          id: row.id,
          originalUrl: row.originalUrl,
          expiresAt: row.expiresAt,
          redirectType: row.redirectType === 301 ? 301 : 302,
        }
      : null;
    this.l1.set(code, link);
    void this.writeL2(code, link);
    return link;
  }

  /** Drops `codes` from every instance's caches. Call after the write commits. */
  async invalidate(codes: string[]): Promise<void> {
    await this.drop(codes);
    if (this.redis && codes.length) {
      setTimeout(() => void this.drop(codes), this.redelayMs).unref();
    }
  }

  /** Subscribes to invalidations published by other instances. */
  async start(): Promise<void> {
    if (!this.redis || this.subscriber) return;
    const sub = this.redis.duplicate();
    sub.on("error", (err) => logger.error({ err }, "Link invalidation subscriber error"));
    try {
      await sub.connect();
      await sub.subscribe(CHANNEL, (message) => {
        for (const code of parseCodes(message)) this.l1.delete(code);
      });
      this.subscriber = sub;
    } catch (err) {
      logger.warn({ err }, "Link invalidation subscriber unavailable; L1 relies on its TTL");
    }
  }

  async stop(): Promise<void> {
    await this.subscriber?.quit().catch(() => {});
    this.subscriber = null;
  }

  private async drop(codes: string[]): Promise<void> {
    for (const code of codes) this.l1.delete(code);
    if (!this.redis || !codes.length) return;
    try {
      await this.redis.del(codes.map(keyOf));
      await this.redis.publish(CHANNEL, JSON.stringify(codes));
    } catch (err) {
      logger.warn({ err, codes }, "Link cache invalidation failed; L2 entries expire on their TTL");
    }
  }

  private async readL2(code: string): Promise<CachedLink | null | undefined> {
    if (!this.redis) return undefined;
    try {
      const raw = await this.redis.get(keyOf(code));
      if (raw === null) return undefined;
      const v = JSON.parse(raw) as Stored;
      if ("missing" in v) return null;
      return {
        id: v.id,
        originalUrl: v.url,
        expiresAt: v.expiresAt ? new Date(v.expiresAt) : null,
        redirectType: v.redirectType,
      };
    } catch (err) {
      logger.warn({ err, code }, "Link L2 read failed; using the database");
      return undefined;
    }
  }

  private async writeL2(code: string, link: CachedLink | null): Promise<void> {
    if (!this.redis) return;
    const value: Stored = link
      ? {
          id: link.id,
          url: link.originalUrl,
          expiresAt: link.expiresAt?.toISOString() ?? null,
          redirectType: link.redirectType,
        }
      : { missing: true };
    try {
      await this.redis.sendCommand([
        "SET",
        keyOf(code),
        JSON.stringify(value),
        "EX",
        String(link ? HIT_TTL_S : MISS_TTL_S),
      ]);
    } catch (err) {
      logger.warn({ err, code }, "Link L2 write failed");
    }
  }
}

export const linkStore = new LinkStore(linksRepository, sharedRedis as unknown as RedisLike | null);
```

In `src/index.ts`, add `import { linkStore } from "./modules/links/link-store";`. After `const app = createApp();` add `void linkStore.start();`. In `shutdown`, change `.then(() => Promise.all([pool.end(), redis?.quit()]))` to:

```ts
      .then(() => linkStore.stop())
      .then(() => Promise.all([pool.end(), redis?.quit()]))
```

- [ ] **Step 4: Run the test.** Run: `bun run test tests/link-store.test.ts`. Expected: PASS (7 tests). Other test files fail to compile until Tasks 4–5 (they still import `linkCache`); that's expected here.

- [ ] **Step 5: Commit**

```bash
git add src/modules/links/link-cache.ts src/modules/links/link-store.ts src/index.ts tests/link-store.test.ts
git commit -m "feat: two-level redirect cache with Redis pub/sub invalidation"
```

---

### Task 4: Redirect — status per link, Cache-Control, noindex, robots.txt

**Files:**

- Modify: `src/modules/redirect/redirect.service.ts`, `redirect.controller.ts`, `redirect.routes.ts`
- Test: `tests/redirect.service.test.ts` (rewrite), `tests/app.test.ts` (add cases)

**Interfaces:**

- Consumes: `LinkStore.get(code): Promise<CachedLink | null>`, `linkStore`.
- Produces:
  - `RedirectService(links: Pick<LinkStore, "get">, clicks: Pick<ClickRecorder, "enqueue">)`
  - `resolve(code, meta): Promise<{ url: string; redirectType: 301 | 302 }>`

- [ ] **Step 1: Write the failing tests**

Replace `tests/redirect.service.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedirectService } from "../src/modules/redirect/redirect.service";
import type { CachedLink } from "../src/modules/links/link-cache";
import { GoneError, NotFoundError } from "../src/common/errors";

const link = (over: Partial<CachedLink> = {}): CachedLink => ({
  id: 9,
  originalUrl: "https://t.com",
  expiresAt: null,
  redirectType: 302,
  ...over,
});

let links: { get: ReturnType<typeof vi.fn> };
let clicks: { enqueue: ReturnType<typeof vi.fn> };
let service: RedirectService;

beforeEach(() => {
  links = { get: vi.fn() };
  clicks = { enqueue: vi.fn() };
  service = new RedirectService(links, clicks);
});

describe("resolve", () => {
  it("returns the destination and the link's redirect type, and queues the click", async () => {
    links.get.mockResolvedValue(link({ redirectType: 301 }));
    expect(await service.resolve("abc1234", { ip: "1.2.3.4" })).toEqual({
      url: "https://t.com",
      redirectType: 301,
    });
    expect(clicks.enqueue).toHaveBeenCalledWith(9, { ip: "1.2.3.4" });
  });

  it("404s impossible codes without a lookup", async () => {
    for (const code of ["favicon.ico", "api", "x", "a".repeat(40)]) {
      await expect(service.resolve(code, {})).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(links.get).not.toHaveBeenCalled();
  });

  it("404s an unknown code", async () => {
    links.get.mockResolvedValue(null);
    await expect(service.resolve("nope", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("410s an expired link without counting it", async () => {
    links.get.mockResolvedValue(link({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.resolve("abc1234", {})).rejects.toBeInstanceOf(GoneError);
    expect(clicks.enqueue).not.toHaveBeenCalled();
  });
});
```

Add to `tests/app.test.ts`, inside the `describe`:

```ts
it("serves robots.txt that blocks only the API", async () => {
  const res = await request(app).get("/robots.txt");
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/text\/plain/);
  expect(res.text).toBe("User-agent: *\nDisallow: /api/\n");
});

it("marks redirect-route responses noindex, even 404s", async () => {
  const res = await request(app).get("/favicon.ico");
  expect(res.status).toBe(404);
  expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `bun run test tests/redirect.service.test.ts tests/app.test.ts`. Expected: FAIL. The redirect test fails on the constructor shape or the return value; the app tests fail on robots.txt (404) and the missing header.

- [ ] **Step 3: Implement**

`src/modules/redirect/redirect.service.ts`:

```ts
import { GoneError, NotFoundError } from "../../common/errors";
import type { RedirectMeta } from "../analytics/click-analytics";
import { clickRecorder, type ClickRecorder } from "../analytics/click-recorder";
import { isPossibleCode } from "../links/codes";
import { linkStore, type LinkStore } from "../links/link-store";

/** Where to send the visitor, and how. */
export interface Resolved {
  url: string;
  redirectType: 301 | 302;
}

/** Resolves public short codes to destinations and records the click. */
export class RedirectService {
  constructor(
    private readonly links: Pick<LinkStore, "get">,
    private readonly clicks: Pick<ClickRecorder, "enqueue">,
  ) {}

  /** 404 if unknown, 410 if expired; otherwise queues the click. */
  async resolve(code: string, meta: RedirectMeta): Promise<Resolved> {
    // Skip lookups for paths that can't be codes (favicon.ico, /api/…, scans).
    if (!isPossibleCode(code)) throw new NotFoundError("Short link not found");
    const link = await this.links.get(code);
    if (!link) throw new NotFoundError("Short link not found");
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new GoneError("Short link has expired");
    }
    this.clicks.enqueue(link.id, meta);
    return { url: link.originalUrl, redirectType: link.redirectType };
  }
}

export const redirectService = new RedirectService(linkStore, clickRecorder);
```

In `src/modules/redirect/redirect.controller.ts`, replace the end of the handler (`const destination = await …` through `res.redirect(302, destination);`) with:

```ts
const { url, redirectType } = await redirectService.resolve(req.params.code, {
  referer: req.get("referer") ?? undefined,
  userAgent: req.get("user-agent") ?? undefined,
  ip: req.ip,
  utmSource: str(q.utm_source),
  utmMedium: str(q.utm_medium),
  utmCampaign: str(q.utm_campaign),
  channel: req.params.channel,
  queryKeys: Object.keys(q),
});
// A 301 is cached by browsers; cap it so later edits still reach repeat
// visitors (those cached hits are not counted). 302s are never cached.
res.set("Cache-Control", redirectType === 301 ? "private, max-age=3600" : "private, max-age=0");
res.redirect(redirectType, url);
```

`src/modules/redirect/redirect.routes.ts`:

```ts
import { Router, type NextFunction, type Request, type Response } from "express";
import { limiter } from "../../common/middleware/rate-limit";
import { env } from "../../config/env";
import { redirectController } from "./redirect.controller";

/** Short links are never search results; preview bots may still fetch them. */
const noindex = (_req: Request, res: Response, next: NextFunction) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
};

/**
 * Public routes. robots.txt blocks only the API so link-preview bots can follow
 * short links (and see noindex). GET /:code[/:channel] has its own, much higher
 * per-minute limit. Mount last so it never shadows API/health routes.
 */
export const redirectRoutes = Router();

redirectRoutes.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /api/\n");
});

redirectRoutes.get(
  "/:code/:channel?",
  noindex,
  limiter("redirect", 60_000, env.REDIRECT_RATE_LIMIT_MAX),
  redirectController.redirect,
);
```

- [ ] **Step 4: Run the tests.** Run: `bun run test tests/redirect.service.test.ts tests/app.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/redirect tests/redirect.service.test.ts tests/app.test.ts
git commit -m "feat: per-link 301/302 with Cache-Control, noindex header, robots.txt"
```

---

### Task 5: Links — create extras, PATCH, search and creator filters

**Files:**

- Modify: `src/modules/links/links.schema.ts`, `links.repository.ts`, `links.service.ts`, `links.controller.ts`, `links.routes.ts`
- Test: `tests/links.schema.test.ts`, `tests/links.service.test.ts` (update fixtures, add cases)

**Interfaces:**

- Consumes:
  - `applyUtm`, `readUtm`, `Utm`, `UtmPatch` (Task 1)
  - `LinkStore.invalidate(codes)`, `linkStore` (Task 3)
  - `Url` fields from Task 2
- Produces:
  - `updateLinkSchema`, `UpdateLinkBody`
  - `CreateLinkInput` gains `title?`, `description?`, `redirectType?`, `utm?`
  - `UpdateLinkInput`
  - `LinkView` gains `title`, `description`, `redirectType`, `utm: Utm` and `updatedAt`
  - `LinksService(repo, store: Pick<LinkStore, "invalidate"> = linkStore)`
  - `LinksService.update(actor, id, input): Promise<LinkView>`
  - `LinksRepository.update(id, organizationId, fields): Promise<Url | undefined>`
  - `ListLinksParams` / `ListLinksInput` gain `q?` and `userId?`

- [ ] **Step 1: Write the failing tests**

Add to `tests/links.schema.test.ts` (and add `updateLinkSchema` to the import):

```ts
describe("create extras", () => {
  it("accepts title, description, redirectType and utm", () => {
    const res = createLinkSchema.safeParse({
      url: "https://a.com",
      title: "  Launch  ",
      description: "d",
      redirectType: 301,
      utm: { source: "x", term: null },
    });
    expect(res.success && res.data.title).toBe("Launch");
  });

  it("rejects other redirect types, unknown utm keys and long values", () => {
    const bad = [
      { redirectType: 307 },
      { utm: { utm_source: "x" } },
      { title: "x".repeat(201) },
      { description: "x".repeat(1001) },
      { title: "   " },
      { utm: { source: "x".repeat(201) } },
    ];
    for (const extra of bad) {
      expect(createLinkSchema.safeParse({ url: "https://a.com", ...extra }).success).toBe(false);
    }
  });
});

describe("updateLinkSchema", () => {
  it("clears nullable fields with null — including expiresAt", () => {
    expect(updateLinkSchema.parse({ expiresAt: null, title: null, description: null })).toEqual({
      expiresAt: null,
      title: null,
      description: null,
    });
  });

  it("still requires a future expiresAt when one is given", () => {
    expect(updateLinkSchema.safeParse({ expiresAt: "2001-01-01T00:00:00Z" }).success).toBe(false);
    expect(updateLinkSchema.safeParse({ expiresAt: "2099-01-01T00:00:00Z" }).success).toBe(true);
  });

  it("rejects an empty body, unknown keys and nulls on non-nullable fields", () => {
    for (const body of [
      {},
      { customAlias: "x" },
      { url: null },
      { code: null },
      { redirectType: null },
    ]) {
      expect(updateLinkSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("list filters", () => {
  it("accepts q and userId", () => {
    expect(listLinksQuerySchema.parse({ q: "  launch ", userId: "u1" })).toMatchObject({
      q: "launch",
      userId: "u1",
    });
    expect(listLinksQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(listLinksQuerySchema.safeParse({ q: "   " }).success).toBe(false);
  });
});
```

In `tests/links.service.test.ts`:

- Add `title: null, description: null, redirectType: 302, updatedAt: new Date("2026-10-08T10:00:00.123Z"),` to `makeUrl`'s defaults.
- Add `update: vi.fn(),` to `makeRepo`.
- Remove the `LinkCache` import and `let cache`.
- Add `let store: { invalidate: ReturnType<typeof vi.fn> };` and in `beforeEach`: `store = { invalidate: vi.fn().mockResolvedValue(undefined) }; service = new LinksService(repo, store);`.
- Replace the "evicts the cached redirect" test with:

```ts
it("invalidates the redirect cache for its code", async () => {
  repo.findByPublicId.mockResolvedValue(makeUrl());
  repo.softDelete.mockResolvedValue(true);
  await service.remove(owner, LINK_ID);
  expect(store.invalidate).toHaveBeenCalledWith(["abc1234"]);
});
```

- Add to `describe("create")`:

```ts
it("invalidates the new code so a cached miss can't hide it", async () => {
  repo.create.mockImplementation((d: Partial<Url>) => makeUrl(d));
  await service.create(owner, { url: "https://x.com", code: "promo" });
  expect(store.invalidate).toHaveBeenCalledWith(["promo"]);
});

it("applies utm to the destination and returns the extras", async () => {
  repo.create.mockImplementation((d: Partial<Url>) => makeUrl(d));
  const link = await service.create(owner, {
    url: "https://x.com/p?a=1",
    title: "T",
    redirectType: 301,
    utm: { source: "news" },
  });
  expect(repo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      originalUrl: "https://x.com/p?a=1&utm_source=news",
      title: "T",
      redirectType: 301,
    }),
  );
  expect(link.utm).toEqual({
    source: "news",
    medium: null,
    campaign: null,
    term: null,
    content: null,
  });
  expect(link.redirectType).toBe(301);
});

it("400s when utm pushes the URL past 2048 chars", async () => {
  const url = `https://x.com/${"a".repeat(2030)}`;
  await expect(
    service.create(owner, { url, utm: { campaign: "c".repeat(50) } }),
  ).rejects.toBeInstanceOf(BadRequestError);
  expect(repo.create).not.toHaveBeenCalled();
});
```

- Add a new block:

```ts
describe("update", () => {
  beforeEach(() => {
    repo.findByPublicId.mockResolvedValue(makeUrl({ userId: "user-1" }));
    repo.update.mockImplementation((_id: number, _org: string, f: Partial<Url>) =>
      makeUrl({ userId: "user-1", ...f }),
    );
  });

  it("changes only the given fields and returns the new view", async () => {
    const link = await service.update(owner, LINK_ID, { title: "New", expiresAt: null });
    expect(repo.update).toHaveBeenCalledWith(1, "org-1", { title: "New", expiresAt: null });
    expect(link.title).toBe("New");
  });

  it("frees the old code and invalidates both codes", async () => {
    const link = await service.update(owner, LINK_ID, { code: "fresh" });
    expect(link.code).toBe("fresh");
    expect(store.invalidate).toHaveBeenCalledWith(["abc1234", "fresh"]);
  });

  it("merges utm into the current URL when url is omitted", async () => {
    repo.findByPublicId.mockResolvedValue(
      makeUrl({ originalUrl: "https://example.com/?utm_source=a&k=v" }),
    );
    await service.update(owner, LINK_ID, { utm: { source: null, medium: "email" } });
    expect(repo.update).toHaveBeenCalledWith(1, "org-1", {
      originalUrl: "https://example.com/?k=v&utm_medium=email",
    });
  });

  it("merges utm into a new url when both are given", async () => {
    await service.update(owner, LINK_ID, { url: "https://new.com/x", utm: { source: "s" } });
    expect(repo.update).toHaveBeenCalledWith(1, "org-1", {
      originalUrl: "https://new.com/x?utm_source=s",
    });
  });

  it("lets a member edit only their own links", async () => {
    await expect(service.update(member, LINK_ID, { title: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.update).not.toHaveBeenCalled();
    repo.findByPublicId.mockResolvedValue(makeUrl({ userId: "user-2" }));
    await expect(service.update(member, LINK_ID, { title: "x" })).resolves.toBeDefined();
  });

  it("maps reserved and taken codes to 409", async () => {
    await expect(service.update(owner, LINK_ID, { code: "api" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    repo.update.mockRejectedValue({ code: "23505" });
    await expect(service.update(owner, LINK_ID, { code: "taken" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(store.invalidate).not.toHaveBeenCalled();
  });

  it("404s another org's link, malformed ids, and a link deleted meanwhile", async () => {
    await expect(service.update(owner, "abc", { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    repo.findByPublicId.mockResolvedValue(undefined);
    await expect(service.update(owner, LINK_ID, { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    repo.findByPublicId.mockResolvedValue(makeUrl());
    repo.update.mockResolvedValue(undefined);
    await expect(service.update(owner, LINK_ID, { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
```

- In `describe("list")`, add:

```ts
it("passes q and userId through to the repository", async () => {
  repo.list.mockResolvedValue([]);
  await service.list("org-1", { ...input, q: "launch", userId: "u1" });
  expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ q: "launch", userId: "u1" }));
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `bun run test tests/links.schema.test.ts tests/links.service.test.ts`. Expected: FAIL. `updateLinkSchema` is missing, `service.update` is not a function, and the extras are absent.

- [ ] **Step 3: Implement**

`src/modules/links/links.schema.ts`: keep `destinationUrlSchema`, `codeSchema` and `futureDateSchema` unchanged. Replace everything from `/** POST /api/v1/links` down with:

```ts
const titleSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().min(1).max(1000);
const redirectTypeSchema = z.union([z.literal(301), z.literal(302)]);
const utmValue = z.string().trim().min(1).max(200).nullable().optional();

/** Campaign params merged into the destination URL; `null` removes one. */
export const utmSchema = z
  .object({
    source: utmValue,
    medium: utmValue,
    campaign: utmValue,
    term: utmValue,
    content: utmValue,
  })
  .strict();

/** POST /api/v1/links. Unknown keys are rejected so typos fail loudly. */
export const createLinkSchema = z
  .object({
    url: destinationUrlSchema,
    code: codeSchema.optional(),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    expiresAt: futureDateSchema.optional(),
    redirectType: redirectTypeSchema.optional(),
    utm: utmSchema.optional(),
  })
  .strict();

/**
 * PATCH /api/v1/links/:id — JSON merge: omitted = unchanged, null = cleared.
 * `expiresAt` checks null before coercing (z.coerce.date turns null into 1970).
 */
export const updateLinkSchema = z
  .object({
    url: destinationUrlSchema.optional(),
    code: codeSchema.optional(),
    title: titleSchema.nullable().optional(),
    description: descriptionSchema.nullable().optional(),
    expiresAt: z.union([z.null(), futureDateSchema]).optional(),
    redirectType: redirectTypeSchema.optional(),
    utm: utmSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "body: at least one field is required");

/** GET /api/v1/links: keyset pagination, sort, search and creator filter. */
export const listLinksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  sort: z.enum(["createdAt", "clicks"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().trim().min(1).max(100).optional(),
  userId: z.string().min(1).max(64).optional(),
});

export type CreateLinkBody = z.infer<typeof createLinkSchema>;
export type UpdateLinkBody = z.infer<typeof updateLinkSchema>;
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;
```

`src/modules/links/links.repository.ts`:

- Change the drizzle import to `import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";`.
- In `CreateLinkData`, add `title?: string; description?: string; redirectType?: 301 | 302;`.
- Add the exported type:

```ts
/** Columns PATCH may change; `null` clears a nullable column. */
export type UpdateLinkFields = Partial<{
  originalUrl: string;
  code: string;
  title: string | null;
  description: string | null;
  expiresAt: Date | null;
  redirectType: 301 | 302;
}>;
```

- In `ListLinksParams`, add `q?: string; userId?: string;`.
- In `list`, destructure `q` and `userId` and build the conditions:

```ts
const conds: (SQL | undefined)[] = [liveIn(organizationId), after];
if (userId) conds.push(eq(urls.userId, userId));
if (q) {
  // Literal match: escape LIKE wildcards and the escape char itself.
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  conds.push(or(ilike(urls.code, like), ilike(urls.title, like), ilike(urls.originalUrl, like)));
}
```

and use `.where(and(...conds))`.

- Add the method after `findByPublicId`:

```ts
  /** Updates a live link of the organization; undefined if none matched. */
  async update(id: number, organizationId: string, fields: UpdateLinkFields): Promise<Url | undefined> {
    const [row] = await db
      .update(urls)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(urls.id, id), liveIn(organizationId)))
      .returning();
    return row;
  }
```

`src/modules/links/links.service.ts`:

- Imports:
  - Drop the `link-cache` import.
  - Add `import { linkStore, type LinkStore } from "./link-store";` and `import { applyUtm, readUtm, type Utm, type UtmPatch } from "./utm";`.
  - Import `type UpdateLinkFields` from the repository.
- Add `const MAX_URL_LENGTH = 2048;`.
- Extend `LinkView` with these fields after `url`:

```ts
title: string | null;
description: string | null;
redirectType: 301 | 302;
/** UTM params read back from `url` (the URL is the single source of truth). */
utm: Utm;
```

and add `updatedAt: Date;` after `createdAt`.

- Extend the inputs:

```ts
export interface CreateLinkInput {
  url: string;
  code?: string;
  title?: string;
  description?: string;
  expiresAt?: Date;
  redirectType?: 301 | 302;
  utm?: UtmPatch;
}

export interface UpdateLinkInput {
  url?: string;
  code?: string;
  title?: string | null;
  description?: string | null;
  expiresAt?: Date | null;
  redirectType?: 301 | 302;
  utm?: UtmPatch;
}
```

Add `q?: string; userId?: string;` to `ListLinksInput`.

- Add the module-level helper:

```ts
/** Applies a UTM patch and enforces the URL length cap on the result. */
const withUtm = (url: string, utm?: UtmPatch): string => {
  const out = utm ? applyUtm(url, utm) : url;
  if (out.length > MAX_URL_LENGTH) {
    throw new BadRequestError("url: too long after adding UTM parameters (max 2048)");
  }
  return out;
};
```

- Change the constructor's second parameter to `private readonly store: Pick<LinkStore, "invalidate"> = linkStore,`.
- In `create`:
  - Replace `await assertSafeUrl(input.url);` and the `base` object with:

```ts
const url = withUtm(input.url, input.utm);
await assertSafeUrl(url);

const base = {
  publicId: newPublicId("link"),
  originalUrl: url,
  organizationId: actor.organizationId,
  userId: actor.userId,
  title: input.title,
  description: input.description,
  expiresAt: input.expiresAt,
  redirectType: input.redirectType,
};
```

- Replace each `return this.toView(await this.repo.create({ ...base, code: … }));` with `return this.created(await this.repo.create({ ...base, code: … }));`.
- Add this private method:

```ts
  /** A brand-new code may be cached as a miss (someone tried it first): drop that. */
  private async created(row: Url): Promise<LinkView> {
    await this.store.invalidate([row.code]);
    return this.toView(row);
  }
```

- In `list`, pass `q: input.q, userId: input.userId,` to `this.repo.list({ … })`.
- Add `update` after `get`:

```ts
  /** JSON-merge update. Members may edit only links they created. */
  async update(actor: Actor, id: string, input: UpdateLinkInput): Promise<LinkView> {
    const current = await this.find(actor.organizationId, id);
    if (!actor.canManageAll && current.userId !== actor.userId) {
      throw new ForbiddenError("Only organization admins can edit other members' links");
    }
    if (input.code && isReservedCode(input.code)) throw new ConflictError("Code is reserved");

    const fields: UpdateLinkFields = {};
    if (input.url !== undefined || input.utm) {
      const url = withUtm(input.url ?? current.originalUrl, input.utm);
      if (url !== current.originalUrl) await assertSafeUrl(url);
      fields.originalUrl = url;
    }
    if (input.code !== undefined) fields.code = input.code;
    if (input.title !== undefined) fields.title = input.title;
    if (input.description !== undefined) fields.description = input.description;
    if (input.expiresAt !== undefined) fields.expiresAt = input.expiresAt;
    if (input.redirectType !== undefined) fields.redirectType = input.redirectType;

    let row: Url | undefined;
    try {
      row = await this.repo.update(current.id, actor.organizationId, fields);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("Code already taken");
      throw err;
    }
    if (!row) throw new NotFoundError("Link not found");
    // The old code is freed now; drop both so neither serves a stale target.
    await this.store.invalidate([...new Set([current.code, row.code])]);
    return this.toView(row);
  }
```

- In `remove`, replace `this.cache.delete(url.code);` with `await this.store.invalidate([url.code]);`.
- In `toView`, add after `url: url.originalUrl,`:

```ts
      title: url.title,
      description: url.description,
      redirectType: url.redirectType === 301 ? 301 : 302,
      utm: readUtm(url.originalUrl),
```

and `updatedAt: url.updatedAt,` after `createdAt`.

In the "changes only the given fields" test, the repo receives exactly `{ title: "New", expiresAt: null }`. The test "merges utm into the current URL" expects `"https://example.com/?k=v&utm_medium=email"`, which is what `applyUtm` produces for `https://example.com/?utm_source=a&k=v`.

`src/modules/links/links.controller.ts`:

- Import `type UpdateLinkBody` from `./links.schema`.
- Add after `get`:

```ts
  // PATCH /api/v1/links/:id — JSON-merge update.
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json(await linksService.update(actor(req), req.params.id, req.body as UpdateLinkBody));
  }),
```

`src/modules/links/links.routes.ts`:

- Import `updateLinkSchema`.
- Add before the delete route:

```ts
linkRoutes.patch(
  "/:id",
  requirePermission("link", "update"),
  validateBody(updateLinkSchema),
  linksController.update,
);
```

- [ ] **Step 4: Run the full unit suite, typecheck and lint**

Run: `bun run test && bun run typecheck && bun run lint`.
Expected:

- All tests pass.
- Typecheck is clean.
- Lint reports only the existing `tests/email.test.ts:19` error.

If typecheck flags `repo` in `new LinksService(repo, store)` (mocks missing `update`), the `makeRepo` change above was missed.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/modules/links tests/links.schema.test.ts tests/links.service.test.ts
git add src/modules/links tests/links.schema.test.ts tests/links.service.test.ts
git commit -m "feat: PATCH links, title/description, redirect type, UTM builder, search and creator filter"
```

---

### Task 6: DB integration tests

**Files:**

- Modify: `tests/integration.test.ts` (add tests inside the existing `describe`, after "stops redirecting after delete")

**Interfaces:**

- Consumes: the existing `newUser(app, prefix)` helper, `auth` and `app` in the describe scope, `db`, `urls`, `eq`.

- [ ] **Step 1: Add the tests**

```ts
it("creates with extras and redirects with the link's status and headers", async () => {
  const created = await request(app)
    .post("/api/v1/links")
    .set(auth)
    .send({
      url: "https://dest.com/p?a=b%20c",
      title: "Launch",
      redirectType: 301,
      utm: { source: "news", campaign: "launch day" },
    });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    title: "Launch",
    description: null,
    redirectType: 301,
    url: "https://dest.com/p?a=b%20c&utm_source=news&utm_campaign=launch%20day",
    utm: { source: "news", medium: null, campaign: "launch day", term: null, content: null },
  });

  const hit = await request(app).get(`/${created.body.code}`).set("User-Agent", "Mozilla/5.0");
  expect(hit.status).toBe(301);
  expect(hit.headers.location).toBe(created.body.url);
  expect(hit.headers["cache-control"]).toBe("private, max-age=3600");
  expect(hit.headers["x-robots-tag"]).toBe("noindex, nofollow");
});

it("applies edits to redirects immediately, frees old codes, and clears with null", async () => {
  const code = `edit-${Date.now()}`;
  const created = await request(app)
    .post("/api/v1/links")
    .set(auth)
    .send({ url: "https://first.com", code, expiresAt: "2099-01-01T00:00:00Z", title: "T" });
  const id = created.body.id as string;
  expect((await request(app).get(`/${code}`)).headers.location).toBe("https://first.com"); // warm caches

  const moved = await request(app)
    .patch(`/api/v1/links/${id}`)
    .set(auth)
    .send({ url: "https://second.com" });
  expect(moved.status).toBe(200);
  expect(moved.body.updatedAt).not.toBe(created.body.updatedAt);
  const after = await request(app).get(`/${code}`);
  expect(after.headers.location).toBe("https://second.com");
  expect(after.headers["cache-control"]).toBe("private, max-age=0");

  const renamed = await request(app)
    .patch(`/api/v1/links/${id}`)
    .set(auth)
    .send({ code: `${code}-b` });
  expect(renamed.body.code).toBe(`${code}-b`);
  expect((await request(app).get(`/${code}`)).status).toBe(404);
  expect((await request(app).get(`/${code}-b`)).status).toBe(302);

  const cleared = await request(app)
    .patch(`/api/v1/links/${id}`)
    .set(auth)
    .send({ expiresAt: null, title: null });
  expect(cleared.status).toBe(200);
  expect(cleared.body).toMatchObject({ expiresAt: null, title: null });

  expect((await request(app).patch(`/api/v1/links/${id}`).set(auth).send({})).status).toBe(400);
});

it("resolves a code at once even if it was requested before it existed", async () => {
  const code = `soon-${Date.now()}`;
  expect((await request(app).get(`/${code}`)).status).toBe(404); // cached as a miss
  await request(app)
    .post("/api/v1/links")
    .set(auth)
    .send({ url: "https://now.com", code })
    .expect(201);
  expect((await request(app).get(`/${code}`)).headers.location).toBe("https://now.com");
});

it("searches code, title and URL literally, and filters by creator", async () => {
  const { auth: solo, userId } = await newUser(app, "search");
  const mk = (body: object) => request(app).post("/api/v1/links").set(solo).send(body).expect(201);
  const a = await mk({ url: "https://alpha.example/x", title: "Summer sale" });
  const b = await mk({ url: "https://beta.example/100%25-off" });
  const c = await mk({ url: "https://gamma.example", code: `zeta_${Date.now()}` });
  const ids = (res: request.Response) =>
    (res.body.data as { id: string }[]).map((l) => l.id).sort();
  const search = (q: string) => request(app).get("/api/v1/links").query({ q }).set(solo);

  expect(ids(await search("SUMMER"))).toEqual([a.body.id]);
  expect(ids(await search("beta.example"))).toEqual([b.body.id]);
  expect(ids(await search("zeta_"))).toEqual([c.body.id]);
  expect(ids(await search("%"))).toEqual([b.body.id]); // only the URL with a literal %
  expect(ids(await search("nomatch"))).toEqual([]);

  const mine = await request(app).get("/api/v1/links").query({ userId }).set(solo);
  expect(ids(mine)).toEqual([a.body.id, b.body.id, c.body.id].sort());
  const nobody = await request(app)
    .get("/api/v1/links")
    .query({ userId: "someone-else" })
    .set(solo);
  expect(nobody.body.data).toEqual([]);
});
```

`"https://beta.example/100%25-off"` is the only URL containing a literal `%`. If the zeta link's code is a random 7-char code, `zeta_` can only match that link's custom code, so the assertions are deterministic.

In the existing membership test ("enforces membership on every request…"), add after `expect(denied.status).toBe(403);`:

```ts
const editDenied = await request(app)
  .patch(`/api/v1/links/${ownerLink.body.id}`)
  .set(m.auth)
  .send({ title: "hijack" });
expect(editDenied.status).toBe(403);
```

- [ ] **Step 2: Migrate the test DB and run**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/url_shortener_test BETTER_AUTH_SECRET=01234567890123456789012345678901 bun run db:migrate
RUN_DB_TESTS=1 AUTH_RATE_LIMIT_MAX=10000 RATE_LIMIT_MAX=10000 DATABASE_URL=postgresql://postgres:postgres@localhost:5433/url_shortener_test REDIS_URL=redis://localhost:6380 bun run test
```

Expected: every test passes; the exit code is 0. Read the summary line, not just the exit code.

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write tests/integration.test.ts
git add tests/integration.test.ts
git commit -m "test: link editing, redirect headers, miss-cache, search integration coverage"
```

---

### Task 7: Docs and collections

**Files:**

- Modify: `docs/api/links.md`, `README.md`, `docs/frontend-spec.md`, `url-shortener.postman_collection.json`
- Create: `bruno/Links/Update Link.bru`

- [ ] **Step 1: `docs/api/links.md`**
  - **Resource JSON:** add `"title": "Launch post"`, `"description": null`, `"redirectType": 302`, `"utm": { "source": null, "medium": null, "campaign": null, "term": null, "content": null }` and `"updatedAt": "…"`.
  - **Endpoints table:** add `| PATCH | /api/v1/links/:id | link:update | 200 |`.
  - **POST section:** document `title` (≤200), `description` (≤1000), `redirectType` (`301`/`302`, default 302) and `utm` (`source`, `medium`, `campaign`, `term`, `content`, each ≤200; merged into `url`; the URL must stay ≤2048 after merging).
  - **New PATCH section:**
    - JSON merge semantics: omitted is unchanged, `null` clears `title`, `description` or `expiresAt`; an empty body returns 400.
    - `utm` applies to the new `url` if both are sent, otherwise to the current one.
    - Changing `code` frees the old one immediately, so links already shared with the old code stop working.
    - Members can edit only links they created.
  - **GET list table:** add `q` (1–100 chars; code, title or URL; case-insensitive; literal) and `userId` (creator).
  - **Redirect section:**
    - `301` or `302` per `redirectType`.
    - `Cache-Control: private, max-age=0` for 302 and `max-age=3600` for 301 (repeat visits within the hour are served from the browser cache and are not counted).
    - `X-Robots-Tag: noindex, nofollow` on every response.
    - `GET /robots.txt` blocks only `/api/`.

- [ ] **Step 2: `README.md`.** In the "Links (v1)" table:
  - Add `| PATCH | /api/v1/links/:id | yes | { url?, code?, title?, description?, expiresAt?, redirectType?, utm? } | Edit a link |`.
  - Change the create body to `{ url, code?, title?, description?, expiresAt?, redirectType?, utm? }` and the list query to `?limit&cursor&sort&order&q&userId`.
  - Change the redirect row to "Redirect (301/302 per link); 410 if expired".

  Add one sentence under the table: redirects are cached in-process and in Redis (when `REDIS_URL` is set), and edits reach every instance immediately via pub/sub.

- [ ] **Step 3: `docs/frontend-spec.md`**
  - **API status table:** mark "Link editing" as shipped. Move it into the "Shipped today" sentence and remove its row.
  - **§4.4:**
    - Add create fields `title`, `description`, `redirectType` and `utm`, and the new response fields.
    - Add an "Update link" subsection mirroring `docs/api/links.md`'s PATCH section.
    - Add `q` and `userId` to the list query.
  - **§4.5:** "301 or 302 per link" plus the noindex header.
  - **§6:**
    - Create form gains: title, description, UTM builder (5 inputs), and a redirect type toggle with the 301 caveat.
    - Link detail gains: "Edit" (same form, PATCH with only the changed fields; send `null` to clear).
    - Links list gains: a search box (`q`, debounced 300 ms; resets the cursor) and a "Created by me" toggle (`userId=session.user.id`).
  - **§7 types:**
    - `Link` gains `title`, `description`, `redirectType: 301 | 302`, `utm: Utm` and `updatedAt`.
    - Add `type Utm = Record<"source"|"medium"|"campaign"|"term"|"content", string | null>`.
    - `CreateLinkBody` gains `title?`, `description?`, `redirectType?`, `utm?: Partial<Utm>`.
    - Add `UpdateLinkBody` (all optional; `title`, `description` and `expiresAt` accept `null`).
    - `ListLinksQuery` gains `q?` and `userId?`.

- [ ] **Step 4: Bruno — `bruno/Links/Update Link.bru`**

```
meta {
  name: Update Link
  type: http
  seq: 5
}

patch {
  url: {{baseUrl}}/api/v1/links/{{linkId}}
  body: json
  auth: bearer
}

auth:bearer {
  token: {{sessionToken}}
}

body:json {
  {
    "title": "Edited from Bruno",
    "redirectType": 301,
    "utm": { "source": "bruno", "medium": "test" }
  }
}

tests {
  test('200 OK', () => expect(res.getStatus()).to.equal(200));
  try {
    const d = res.getBody();
    test('title updated', () => expect(d.title).to.equal('Edited from Bruno'));
    test('redirect type', () => expect(d.redirectType).to.equal(301));
    test('utm merged into url', () => expect(d.url).to.include('utm_source=bruno'));
    test('utm read back', () => expect(d.utm.medium).to.equal('test'));
  } catch (e) {}
}

docs {
  JSON-merge update: omitted fields are unchanged; null clears title, description or expiresAt.
  Changing code frees the old code immediately.
}
```

In `bruno/Links/Redirect.bru`, if its test asserts status `302` exactly, change that test to accept 301 or 302: `expect([301, 302]).to.include(res.getStatus())`. The redirects run after Update Link, which sets 301.

- [ ] **Step 5: Postman.** Splice in an "Update Link" request after "Get Link" in the `Links` folder. Edit the text of the original file; don't re-serialize it, because the original isn't uniformly Prettier-formatted:
  - method `PATCH`, URL `{{baseUrl}}/api/v1/links/{{linkId}}`, bearer auth as in the sibling requests
  - the same JSON body as Bruno
  - test script `pm.test('200 OK', () => pm.response.to.have.status(200));`

Copy the "Get Link" item's object text, change the name, method, body and test, and insert it after that item. Validate with `python3 -c "import json;json.load(open('url-shortener.postman_collection.json'))"`.

- [ ] **Step 6: Run the Bruno collection end to end**

```bash
(AUTH_RATE_LIMIT_MAX=10000 RATE_LIMIT_MAX=10000 bun src/index.ts > "$TMPDIR/server.log" 2>&1 &)
cd bruno && npx @usebruno/cli run --env Local --env-var email=me+$(date +%s)@example.com; cd ..
pkill -f "bun src/index.ts"
```

Expected: all requests pass, including `Links/Update Link`.

- [ ] **Step 7: Format the touched docs and commit**

```bash
npx prettier --write docs/api/links.md docs/frontend-spec.md README.md
git add README.md docs bruno url-shortener.postman_collection.json
git commit -m "docs: link editing, redirect headers and search in API docs, FE spec, collections"
```

---

## Phase B done when

- `bun run test && bun run typecheck` pass, and lint shows only the existing `email.test.ts` error.
- The DB suite (command in Global Constraints) passes with exit code 0 and a summary line showing 0 failures.
- The Bruno collection passes end to end.
- `PATCH` and every new field are documented in `docs/api/links.md` and `docs/frontend-spec.md`.
