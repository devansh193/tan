import { describe, it, expect } from "vitest";
import { anonymizeIp, buildClickData } from "../src/modules/analytics/click-analytics";

describe("buildClickData", () => {
  it("parses geo, UA, referer, and UTM query params", () => {
    const data = buildClickData({
      ip: "8.8.8.8",
      referer: "https://google.com/search?q=test",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "launch",
    });

    expect(data.ip).toBe("8.8.8.0"); // stored anonymized, geo used the full IP
    expect(data.country).toBe("US");
    expect(data.browser).toMatch(/^Chrome/);
    expect(data.os).toMatch(/^macOS/);
    expect(data.device).toBe("desktop");
    expect(data.referer).toBe("https://google.com/search?q=test");
    expect(data.utmSource).toBe("newsletter");
    expect(data.utmMedium).toBe("email");
    expect(data.utmCampaign).toBe("launch");
  });

  it("falls back to UTM params on the referer URL", () => {
    const data = buildClickData({
      referer: "https://example.com/page?utm_source=twitter&utm_medium=social&utm_campaign=promo",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    });

    expect(data.utmSource).toBe("twitter");
    expect(data.utmMedium).toBe("social");
    expect(data.utmCampaign).toBe("promo");
    expect(data.device).toBe("mobile");
  });
});

describe("anonymizeIp", () => {
  it("truncates IPv4 to /24 and IPv6 to /48", () => {
    expect(anonymizeIp("203.0.113.77")).toBe("203.0.113.0");
    expect(anonymizeIp("::ffff:203.0.113.77")).toBe("203.0.113.0");
    expect(anonymizeIp("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::");
    expect(anonymizeIp("2001:db8::1")).toBe("2001:db8::");
    expect(anonymizeIp("garbage")).toBeUndefined();
  });
});
