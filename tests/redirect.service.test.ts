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
