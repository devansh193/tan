import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor } from "../src/common/cursor";
import { BadRequestError } from "../src/common/errors";

describe("cursor", () => {
  it("round-trips", () => {
    const c = { k: "2026-10-08T10:00:00.123Z", id: "link_abc" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor({ k: 42, id: "link_x" }))).toEqual({ k: 42, id: "link_x" });
  });

  it("is URL-safe", () => {
    expect(encodeCursor({ k: "??>>~~", id: "link_x" })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects tampered or malformed cursors with a 400", () => {
    const bad = [
      "",
      "not-base64!!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from('{"k":1}').toString("base64url"),
      Buffer.from('{"k":{},"id":"x"}').toString("base64url"),
      encodeCursor({ k: 1, id: "link_x" }).slice(0, -3),
      // Postgres rejects NUL in text params (22021) — must be a 400, not a 500.
      encodeCursor({ k: 1, id: "link_a\u0000b" }),
      encodeCursor({ k: 1, id: "not-an-id" }),
    ];
    for (const raw of bad) expect(() => decodeCursor(raw)).toThrow(BadRequestError);
  });
});
