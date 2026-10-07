import { describe, it, expect } from "vitest";
import { createUrlSchema } from "../src/modules/url/url.schema";

const ok = (url: string) => createUrlSchema.safeParse({ url }).success;

describe("createUrlSchema", () => {
  it("accepts plain http(s) URLs", () => {
    expect(ok("https://example.com/a?b=c")).toBe(true);
  });

  it("rejects non-http, embedded credentials, and self-links", () => {
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("https://bank.com@evil.com/login")).toBe(false);
    expect(ok("http://localhost:3000/abc1234")).toBe(false); // BASE_URL in tests
  });
});
