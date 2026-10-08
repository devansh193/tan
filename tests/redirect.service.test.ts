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
