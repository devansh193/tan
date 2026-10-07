import { describe, it, expect } from "vitest";
import { createLinkSchema, listLinksQuerySchema } from "../src/modules/links/links.schema";

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
