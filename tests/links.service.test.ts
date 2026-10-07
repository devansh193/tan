import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinksService, type Actor } from "../src/modules/links/links.service";
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
  service = new LinksService(repo, cache);
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
