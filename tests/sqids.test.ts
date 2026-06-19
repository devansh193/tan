import { describe, it, expect } from "vitest";
import { encodeId, decodeId } from "../src/modules/url/sqids";

describe("sqids bijection", () => {
  it("round-trips a counter id through encode/decode", () => {
    for (const id of [1, 2, 42, 1000, 9_999_999]) {
      expect(decodeId(encodeId(id))).toBe(id);
    }
  });

  it("produces distinct codes for sequential ids", () => {
    expect(encodeId(1)).not.toBe(encodeId(2));
  });

  it("rejects malformed / non-canonical codes", () => {
    expect(decodeId("!!!!")).toBeNull();
    expect(decodeId("")).toBeNull();
  });
});
