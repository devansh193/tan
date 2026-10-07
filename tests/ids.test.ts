import { describe, it, expect } from "vitest";
import { newPublicId, randomBase62 } from "../src/common/ids";
import { generateCode, isPossibleCode, isReservedCode } from "../src/modules/links/codes";

describe("ids", () => {
  it("generates base62 strings of the requested length", () => {
    expect(randomBase62(24)).toMatch(/^[0-9A-Za-z]{24}$/);
    expect(randomBase62(0)).toBe("");
  });

  it("prefixes public ids", () => {
    expect(newPublicId("link")).toMatch(/^link_[0-9A-Za-z]{24}$/);
    expect(newPublicId("tag")).toMatch(/^tag_[0-9A-Za-z]{24}$/);
    expect(newPublicId("link")).not.toBe(newPublicId("link"));
  });
});

describe("codes", () => {
  it("generates 7-char codes", () => {
    expect(generateCode()).toMatch(/^[0-9A-Za-z]{7}$/);
  });

  it("knows which strings can be codes", () => {
    expect(isPossibleCode("abc1234")).toBe(true);
    expect(isPossibleCode("promo_2026-x")).toBe(true);
    for (const bad of ["ab", "a".repeat(33), "favicon.ico", "api", "API", "a/b"]) {
      expect(isPossibleCode(bad)).toBe(false);
    }
    expect(isReservedCode("Health")).toBe(true);
  });
});
