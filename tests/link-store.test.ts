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
  return {
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
