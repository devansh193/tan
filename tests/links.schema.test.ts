import { describe, it, expect } from "vitest";
import {
  createLinkSchema,
  listLinksQuerySchema,
  updateLinkSchema,
} from "../src/modules/links/links.schema";

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

describe("autoUtm", () => {
  it("is an optional boolean on create and PATCH, never null", () => {
    expect(createLinkSchema.parse({ url: "https://a.com", autoUtm: true }).autoUtm).toBe(true);
    expect(createLinkSchema.safeParse({ url: "https://a.com", autoUtm: "yes" }).success).toBe(
      false,
    );
    expect(updateLinkSchema.parse({ autoUtm: false })).toEqual({ autoUtm: false });
    expect(updateLinkSchema.safeParse({ autoUtm: null }).success).toBe(false);
  });
});

describe("shareLinks", () => {
  it("is an optional boolean on create and PATCH, never null", () => {
    expect(createLinkSchema.parse({ url: "https://a.com", shareLinks: false }).shareLinks).toBe(
      false,
    );
    expect(updateLinkSchema.parse({ shareLinks: true })).toEqual({ shareLinks: true });
    expect(updateLinkSchema.safeParse({ shareLinks: null }).success).toBe(false);
  });
});
