import { describe, it, expect, vi, beforeEach } from "vitest";
import { UrlService } from "../src/modules/url/url.service";
import { encodeId } from "../src/modules/url/sqids";
import { ConflictError, GoneError, NotFoundError } from "../src/common/errors";
import type { Url } from "../src/db/schema";

/** Builds a Url row with sensible defaults. */
const makeUrl = (over: Partial<Url> = {}): Url => ({
  id: 1,
  originalUrl: "https://example.com",
  customAlias: null,
  userId: "user-1",
  clickCount: 0,
  expiresAt: null,
  deletedAt: null,
  createdAt: new Date(),
  ...over,
});

const makeRepo = () => ({
  create: vi.fn(),
  findById: vi.fn(),
  findByAlias: vi.fn(),
  listByUser: vi.fn(),
  countByUser: vi.fn(),
  softDelete: vi.fn(),
  recordClick: vi.fn().mockResolvedValue(undefined),
  recentClicks: vi.fn(),
});

let repo: ReturnType<typeof makeRepo>;
let service: UrlService;

beforeEach(() => {
  repo = makeRepo();
  service = new UrlService(repo);
});

describe("shorten", () => {
  it("returns the Sqids code when no alias is given", async () => {
    repo.create.mockResolvedValue(makeUrl({ id: 7 }));
    const view = await service.shorten({ originalUrl: "https://x.com", userId: "user-1" });
    expect(view.code).toBe(encodeId(7));
    expect(view.shortUrl).toBe(`http://localhost:3000/${encodeId(7)}`);
  });

  it("prefers the custom alias as the code", async () => {
    repo.create.mockResolvedValue(makeUrl({ id: 7, customAlias: "promo" }));
    const view = await service.shorten({
      originalUrl: "https://x.com",
      userId: "user-1",
      customAlias: "promo",
    });
    expect(view.code).toBe("promo");
  });

  it("rejects a reserved alias", async () => {
    await expect(
      service.shorten({ originalUrl: "https://x.com", userId: "user-1", customAlias: "api" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps a unique-violation to a 409", async () => {
    repo.create.mockRejectedValue({ code: "23505" });
    await expect(
      service.shorten({ originalUrl: "https://x.com", userId: "user-1", customAlias: "taken" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("resolve", () => {
  it("resolves an alias first and records the click", async () => {
    repo.findByAlias.mockResolvedValue(makeUrl({ originalUrl: "https://aliased.com" }));
    const target = await service.resolve("promo", { ip: "1.2.3.4" });
    expect(target).toBe("https://aliased.com");
    expect(repo.recordClick).toHaveBeenCalledOnce();
  });

  it("falls back to the Sqids id when no alias matches", async () => {
    repo.findByAlias.mockResolvedValue(undefined);
    repo.findById.mockResolvedValue(makeUrl({ id: 9, originalUrl: "https://byid.com" }));
    const target = await service.resolve(encodeId(9), {});
    expect(target).toBe("https://byid.com");
    expect(repo.findById).toHaveBeenCalledWith(9);
  });

  it("returns 404 for an unknown code", async () => {
    repo.findByAlias.mockResolvedValue(undefined);
    await expect(service.resolve("!!!!", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns 410 for an expired link", async () => {
    repo.findByAlias.mockResolvedValue(makeUrl({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.resolve("promo", {})).rejects.toBeInstanceOf(GoneError);
  });
});

describe("listForUser", () => {
  it("returns items plus pagination metadata", async () => {
    repo.listByUser.mockResolvedValue([makeUrl()]);
    repo.countByUser.mockResolvedValue(1);
    const page = await service.listForUser("user-1", 20, 0);
    expect(page).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(page.items).toHaveLength(1);
  });
});

describe("remove", () => {
  it("404s when nothing was deleted", async () => {
    repo.findByAlias.mockResolvedValue(makeUrl());
    repo.softDelete.mockResolvedValue(false);
    await expect(service.remove("promo", "user-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("stats", () => {
  it("404s when the caller is not the owner", async () => {
    repo.findByAlias.mockResolvedValue(makeUrl({ userId: "someone-else" }));
    await expect(service.stats("promo", "user-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
