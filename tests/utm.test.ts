import { describe, it, expect } from "vitest";
import { applyUtm, readUtm } from "../src/modules/links/utm";

describe("applyUtm", () => {
  it("adds utm params", () => {
    expect(applyUtm("https://a.com/p", { source: "x", medium: "social" })).toBe(
      "https://a.com/p?utm_source=x&utm_medium=social",
    );
  });

  it("replaces and removes only the keys given", () => {
    const url = "https://a.com/p?utm_source=old&utm_medium=email&a=1";
    expect(applyUtm(url, { source: "new", medium: null })).toBe(
      "https://a.com/p?a=1&utm_source=new",
    );
  });

  it("leaves other params byte-for-byte and keeps the fragment", () => {
    const url = "https://a.com/p?a=b%20c&x=1&x=2&q=a+b#frag";
    expect(applyUtm(url, { campaign: "launch day" })).toBe(
      "https://a.com/p?a=b%20c&x=1&x=2&q=a+b&utm_campaign=launch%20day#frag",
    );
  });

  it("drops the query entirely when the last param is removed", () => {
    expect(applyUtm("https://a.com/p?utm_source=x", { source: null })).toBe("https://a.com/p");
  });

  it("is a no-op for an empty patch", () => {
    expect(applyUtm("https://a.com/p?a=1", {})).toBe("https://a.com/p?a=1");
  });
});

describe("readUtm", () => {
  it("reads all five keys, null when absent, decoded", () => {
    expect(readUtm("https://a.com/?utm_source=x&utm_campaign=launch%20day")).toEqual({
      source: "x",
      medium: null,
      campaign: "launch day",
      term: null,
      content: null,
    });
  });
});
