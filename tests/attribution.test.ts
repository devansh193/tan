import { describe, it, expect } from "vitest";
import { detectSource, isBot, normalizeSource } from "../src/modules/url/attribution";

const UA = {
  chrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.32.112 (iPhone14,5; iOS 17_0)",
  facebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.30.110]",
  linkedin:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [LinkedInApp]/9.29.1",
  threads:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Barcelona 302.0.0.21.111",
  cubot:
    "Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
};

describe("detectSource", () => {
  it("prefers the explicit channel tag over every other signal", () => {
    expect(
      detectSource({
        channel: "li",
        utmSource: "x",
        userAgent: UA.instagram,
        referer: "https://t.co/",
      }),
    ).toEqual({ source: "linkedin", method: "channel" });
  });

  it("falls through utm -> click id -> in-app UA -> referrer -> unknown", () => {
    expect(detectSource({ utmSource: "IG" })).toEqual({ source: "instagram", method: "utm" });
    expect(detectSource({ queryKeys: ["fbclid"] })).toEqual({
      source: "facebook",
      method: "clickid",
    });
    expect(detectSource({ userAgent: UA.instagram })).toEqual({
      source: "instagram",
      method: "ua",
    });
    expect(detectSource({ userAgent: UA.facebook }).source).toBe("facebook");
    expect(detectSource({ userAgent: UA.linkedin }).source).toBe("linkedin");
    expect(detectSource({ userAgent: UA.threads }).source).toBe("threads");
    expect(detectSource({ userAgent: UA.chrome, referer: "https://t.co/xyz" })).toEqual({
      source: "x",
      method: "referer",
    });
    expect(detectSource({ userAgent: UA.chrome })).toEqual({ source: "unknown", method: "none" });
  });

  it("ignores unknown channel tags and matches the most specific referrer", () => {
    expect(detectSource({ channel: "zz" }).method).toBe("none");
    expect(detectSource({ referer: "https://mail.google.com/mail/u/0" }).source).toBe("email");
    expect(detectSource({ referer: "https://www.google.com/" }).source).toBe("google");
    expect(detectSource({ referer: "https://notlinkedin.com/" }).source).toBe("unknown");
  });

  it("normalizes free-form source names", () => {
    expect(normalizeSource(" Twitter ")).toBe("x");
    expect(normalizeSource("newsletter")).toBe("email");
    expect(normalizeSource("Partner-Blog")).toBe("partner-blog");
  });
});

describe("isBot", () => {
  it("flags link-preview crawlers, scripts and missing UAs", () => {
    for (const ua of [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Twitterbot/1.0",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "WhatsApp/2.23.20.0 A",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "curl/8.4.0",
      undefined,
    ]) {
      expect(isBot(ua), String(ua)).toBe(true);
    }
  });

  it("does not flag real browsers, in-app browsers, or 'bot'-ish phone names", () => {
    for (const ua of [UA.chrome, UA.instagram, UA.facebook, UA.linkedin, UA.cubot]) {
      expect(isBot(ua), ua).toBe(false);
    }
  });
});
