import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedirectService } from "../src/modules/redirect/redirect.service";
import type { CachedLink } from "../src/modules/links/link-cache";
import { GoneError, NotFoundError } from "../src/common/errors";

const link = (over: Partial<CachedLink> = {}): CachedLink => ({
  id: 9,
  originalUrl: "https://t.com",
  expiresAt: null,
  redirectType: 302,
  autoUtm: false,
  shareLinks: true,
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

  describe("autoUtm", () => {
    const url = "https://t.com/p?a=1&utm_source=newsletter&utm_medium=email&utm_campaign=c";

    it("sets source and medium from the share tag and keeps the rest", async () => {
      links.get.mockResolvedValue(link({ originalUrl: url, autoUtm: true }));
      const { url: dest } = await service.resolve("abc1234", { channel: "ig" });
      expect(dest).toBe(
        "https://t.com/p?a=1&utm_campaign=c&utm_source=instagram&utm_medium=social",
      );
    });

    it("leaves the stored URL alone without a tag, with an unknown tag, or when off", async () => {
      links.get.mockResolvedValue(link({ originalUrl: url, autoUtm: true }));
      expect((await service.resolve("abc1234", {})).url).toBe(url);
      expect((await service.resolve("abc1234", { channel: "nope" })).url).toBe(url);
      links.get.mockResolvedValue(link({ originalUrl: url, autoUtm: false }));
      expect((await service.resolve("abc1234", { channel: "ig" })).url).toBe(url);
    });

    it("still records the click with the tag", async () => {
      links.get.mockResolvedValue(link({ originalUrl: url, autoUtm: true }));
      await service.resolve("abc1234", { channel: "em" });
      expect(clicks.enqueue).toHaveBeenCalledWith(9, { channel: "em" });
    });
  });

  describe("plain short links (no share links)", () => {
    it("records the link's utm_medium as the click's source signal", async () => {
      links.get.mockResolvedValue(
        link({
          originalUrl: "https://t.com/?utm_source=a&utm_medium=Newsletter",
          shareLinks: false,
        }),
      );
      await service.resolve("abc1234", { ip: "1.2.3.4" });
      expect(clicks.enqueue).toHaveBeenCalledWith(9, { ip: "1.2.3.4", linkMedium: "Newsletter" });
    });

    it("adds nothing without a utm_medium, or when the link has share links", async () => {
      links.get.mockResolvedValue(
        link({ originalUrl: "https://t.com/?utm_source=a", shareLinks: false }),
      );
      await service.resolve("abc1234", {});
      links.get.mockResolvedValue(link({ originalUrl: "https://t.com/?utm_medium=email" }));
      await service.resolve("abc1234", {});
      expect(clicks.enqueue.mock.calls).toEqual([
        [9, {}],
        [9, {}],
      ]);
    });
  });
});
