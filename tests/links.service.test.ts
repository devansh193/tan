import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinksService, type Actor } from "../src/modules/links/links.service";
import { decodeCursor, encodeCursor } from "../src/common/cursor";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../src/common/errors";
import type { Url } from "../src/db/schema";

const LINK_ID = "link_AAAAAAAAAAAAAAAAAAAAAAAA";

/** Builds a Url row with sensible defaults; undefined fields keep them, like column defaults. */
const makeUrl = (over: Partial<Url> = {}): Url => ({
  id: 1,
  publicId: LINK_ID,
  code: "abc1234",
  title: null,
  description: null,
  redirectType: 302,
  autoUtm: false,
  shareLinks: true,
  originalUrl: "https://example.com",
  organizationId: "org-1",
  userId: "user-1",
  clickCount: 0,
  expiresAt: null,
  deletedAt: null,
  createdAt: new Date("2026-10-08T10:00:00.123Z"),
  updatedAt: new Date("2026-10-08T10:00:00.123Z"),
  ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)),
});

const makeRepo = () => ({
  create: vi.fn(),
  findByCode: vi.fn(),
  findByPublicId: vi.fn(),
  list: vi.fn(),
  softDelete: vi.fn(),
  update: vi.fn(),
});

const owner: Actor = { organizationId: "org-1", userId: "user-1", canManageAll: true };
const member: Actor = { organizationId: "org-1", userId: "user-2", canManageAll: false };

let repo: ReturnType<typeof makeRepo>;
let store: { invalidate: ReturnType<typeof vi.fn> };
let service: LinksService;

beforeEach(() => {
  repo = makeRepo();
  store = { invalidate: vi.fn().mockResolvedValue(undefined) };
  service = new LinksService(repo, store);
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
    await expect(
      service.create(owner, { url: "https://x.com", code: "api" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps a taken custom code to 409 without retrying", async () => {
    repo.create.mockRejectedValue({ code: "23505" });
    await expect(
      service.create(owner, { url: "https://x.com", code: "abc1234" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).toHaveBeenCalledOnce();
  });
});

describe("create extras", () => {
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

  it("stores autoUtm and returns it", async () => {
    repo.create.mockImplementation((d: Partial<Url>) => makeUrl(d));
    const link = await service.create(owner, { url: "https://x.com", autoUtm: true });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ autoUtm: true }));
    expect(link.autoUtm).toBe(true);
  });

  it("shareLinks: on by default; off returns no share URLs", async () => {
    repo.create.mockImplementation((d: Partial<Url>) => makeUrl(d));
    expect(
      Object.keys((await service.create(owner, { url: "https://x.com" })).shareUrls),
    ).not.toEqual([]);
    const plain = await service.create(owner, { url: "https://x.com", shareLinks: false });
    expect(repo.create).toHaveBeenLastCalledWith(expect.objectContaining({ shareLinks: false }));
    expect(plain.shareLinks).toBe(false);
    expect(plain.shareUrls).toEqual({});
  });

  it("400s on autoUtm without share links", async () => {
    await expect(
      service.create(owner, { url: "https://x.com", shareLinks: false, autoUtm: true }),
    ).rejects.toThrow("autoUtm: requires shareLinks");
  });

  it("400s when utm pushes the URL past 2048 chars", async () => {
    const url = `https://x.com/${"a".repeat(2030)}`;
    await expect(
      service.create(owner, { url, utm: { campaign: "c".repeat(50) } }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

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

  it("toggles autoUtm and invalidates the cached redirect", async () => {
    const link = await service.update(owner, LINK_ID, { autoUtm: true });
    expect(repo.update).toHaveBeenCalledWith(1, "org-1", { autoUtm: true });
    expect(link.autoUtm).toBe(true);
    expect(store.invalidate).toHaveBeenCalledWith(["abc1234"]);
  });

  it("turning share links off turns autoUtm off too", async () => {
    repo.findByPublicId.mockResolvedValue(makeUrl({ userId: "user-1", autoUtm: true }));
    const link = await service.update(owner, LINK_ID, { shareLinks: false });
    expect(repo.update).toHaveBeenCalledWith(1, "org-1", { shareLinks: false, autoUtm: false });
    expect(link.shareUrls).toEqual({});
  });

  it("400s on autoUtm for a link without share links", async () => {
    repo.findByPublicId.mockResolvedValue(makeUrl({ userId: "user-1", shareLinks: false }));
    await expect(service.update(owner, LINK_ID, { autoUtm: true })).rejects.toThrow(
      "autoUtm: requires shareLinks",
    );
    expect(repo.update).not.toHaveBeenCalled();
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
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3, organizationId: "org-1" }),
    );
    expect(page.data.map((l) => l.id)).toEqual(["link_a", "link_b"]);
    expect(decodeCursor(page.nextCursor!)).toEqual({ k: "2026-10-08T10:00:00.123Z", id: "link_b" });
  });

  it("passes q and userId through to the repository", async () => {
    repo.list.mockResolvedValue([]);
    await service.list("org-1", { ...input, q: "launch", userId: "u1" });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ q: "launch", userId: "u1" }));
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

  it("rejects date keys Date.parse accepts but Postgres can't cast", async () => {
    for (const k of [
      "1",
      "0",
      "2022",
      "Mar 1",
      "2020-02-30T00:00:00Z",
      "+275760-09-13T00:00:00.000Z",
    ]) {
      const cursor = encodeCursor({ k, id: "link_b" });
      await expect(service.list("org-1", { ...input, cursor })).rejects.toBeInstanceOf(
        BadRequestError,
      );
    }
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

  it("invalidates the redirect cache for its code", async () => {
    repo.findByPublicId.mockResolvedValue(makeUrl());
    repo.softDelete.mockResolvedValue(true);
    await service.remove(owner, LINK_ID);
    expect(store.invalidate).toHaveBeenCalledWith(["abc1234"]);
  });
});
