import { describe, it, expect, vi, beforeEach } from "vitest";
import { UrlService } from "../src/modules/url/url.service";
import { ConflictError, ForbiddenError, GoneError, NotFoundError } from "../src/common/errors";
import type { Url } from "../src/db/schema";
import type { UrlRepository } from "../src/modules/url/url.repository";

/** Builds a Url row with sensible defaults. */
const makeUrl = (over: Partial<Url> = {}): Url => ({
  id: 1,
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

const makeRepo = () => ({
  create: vi.fn(),
  findByCode: vi.fn(),
  listByOrganization: vi.fn(),
  countByOrganization: vi.fn(),
  softDelete: vi.fn(),
  sourceBreakdown: vi.fn(),
  recentClicks: vi.fn(),
});

const base = { originalUrl: "https://x.com", organizationId: "org-1", userId: "user-1" };

let repo: ReturnType<typeof makeRepo>;
let clicks: { enqueue: ReturnType<typeof vi.fn> };
let service: UrlService;

beforeEach(() => {
  repo = makeRepo();
  clicks = { enqueue: vi.fn() };
  service = new UrlService(repo as unknown as UrlRepository, clicks);
});

describe("shorten", () => {
  it("stores a random 7-char code when no alias is given", async () => {
    repo.create.mockImplementation((d: { code: string }) => makeUrl({ code: d.code }));
    const view = await service.shorten(base);
    expect(view.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(view.shortUrl).toBe(`http://localhost:3000/${view.code}`);
    expect(view.shareUrls.instagram).toBe(`${view.shortUrl}/ig`);
    expect(view.shareUrls.linkedin).toBe(`${view.shortUrl}/li`);
  });

  it("retries a colliding random code", async () => {
    repo.create
      .mockRejectedValueOnce({ code: "23505" })
      .mockImplementation((d: { code: string }) => makeUrl({ code: d.code }));
    await service.shorten(base);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it("stores the custom alias as the code", async () => {
    repo.create.mockImplementation((d: { code: string }) => makeUrl({ code: d.code }));
    const view = await service.shorten({ ...base, customAlias: "promo" });
    expect(view.code).toBe("promo");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ code: "promo" }));
  });

  it("rejects a reserved alias", async () => {
    await expect(service.shorten({ ...base, customAlias: "api" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("maps an alias that is already any link's code to a 409 (no shadowing)", async () => {
    repo.create.mockRejectedValue({ code: "23505" });
    await expect(service.shorten({ ...base, customAlias: "abc1234" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(repo.create).toHaveBeenCalledOnce();
  });
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

  it("returns 404 for an unknown code", async () => {
    repo.findByCode.mockResolvedValue(undefined);
    await expect(service.resolve("nope", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns 410 for an expired link", async () => {
    repo.findByCode.mockResolvedValue(makeUrl({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.resolve("abc1234", {})).rejects.toBeInstanceOf(GoneError);
    expect(clicks.enqueue).not.toHaveBeenCalled();
  });
});

describe("listForOrganization", () => {
  it("returns items plus pagination metadata", async () => {
    repo.listByOrganization.mockResolvedValue([makeUrl()]);
    repo.countByOrganization.mockResolvedValue(1);
    const page = await service.listForOrganization("org-1", 20, 0);
    expect(page).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(page.items).toHaveLength(1);
  });
});

describe("remove", () => {
  const member = { organizationId: "org-1", userId: "user-2", isOrgAdmin: false };
  const admin = { ...member, isOrgAdmin: true };

  it("404s when nothing was deleted", async () => {
    repo.findByCode.mockResolvedValue(makeUrl());
    repo.softDelete.mockResolvedValue(false);
    await expect(service.remove("abc1234", admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404s another organization's link", async () => {
    repo.findByCode.mockResolvedValue(makeUrl({ organizationId: "other-org" }));
    await expect(service.remove("abc1234", admin)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("lets a plain member delete only their own links", async () => {
    repo.findByCode.mockResolvedValue(makeUrl({ userId: "user-1" }));
    await expect(service.remove("abc1234", member)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.softDelete).not.toHaveBeenCalled();

    repo.findByCode.mockResolvedValue(makeUrl({ userId: "user-2" }));
    repo.softDelete.mockResolvedValue(true);
    await expect(service.remove("abc1234", member)).resolves.toBeUndefined();
  });

  it("lets an admin delete any member's link", async () => {
    repo.findByCode.mockResolvedValue(makeUrl({ userId: "user-1" }));
    repo.softDelete.mockResolvedValue(true);
    await expect(service.remove("abc1234", admin)).resolves.toBeUndefined();
  });

  it("evicts the cached redirect", async () => {
    repo.findByCode.mockResolvedValue(makeUrl());
    repo.softDelete.mockResolvedValue(true);
    await service.resolve("abc1234", {});
    await service.remove("abc1234", {
      organizationId: "org-1",
      userId: "user-1",
      isOrgAdmin: true,
    });
    repo.findByCode.mockResolvedValue(undefined);
    await expect(service.resolve("abc1234", {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("stats", () => {
  it("includes the per-source breakdown", async () => {
    repo.findByCode.mockResolvedValue(makeUrl());
    repo.sourceBreakdown.mockResolvedValue([{ source: "instagram", method: "channel", clicks: 3 }]);
    repo.recentClicks.mockResolvedValue([]);
    const stats = await service.stats("abc1234", "org-1");
    expect(stats.sources).toEqual([{ source: "instagram", method: "channel", clicks: 3 }]);
  });

  it("404s when the link belongs to another organization", async () => {
    repo.findByCode.mockResolvedValue(makeUrl({ organizationId: "other-org" }));
    await expect(service.stats("abc1234", "org-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
