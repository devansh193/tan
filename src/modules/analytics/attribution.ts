/**
 * Click attribution: which platform a click came from, and whether the
 * "click" was actually a bot (link-preview crawler, scraper).
 */

/**
 * Channel tags appended to a short link (`/abc1234/ig`) by the dashboard's
 * share buttons. One link, exact per-platform counts.
 */
export const CHANNELS = {
  ig: "instagram",
  fb: "facebook",
  li: "linkedin",
  x: "x",
  th: "threads",
  tt: "tiktok",
  yt: "youtube",
  rd: "reddit",
  pin: "pinterest",
  sc: "snapchat",
  wa: "whatsapp",
  tg: "telegram",
  em: "email",
  sms: "sms",
  qr: "qr",
} as const;

/** UTM medium per share tag; the source is the platform name from CHANNELS. */
const CHANNEL_MEDIUM: Record<keyof typeof CHANNELS, string> = {
  ig: "social",
  fb: "social",
  li: "social",
  x: "social",
  th: "social",
  tt: "social",
  yt: "social",
  rd: "social",
  pin: "social",
  sc: "social",
  wa: "messaging",
  tg: "messaging",
  em: "email",
  sms: "sms",
  qr: "offline",
};

/**
 * The `utm_source`/`utm_medium` a share tag stands for (`ig` → instagram/social),
 * so the destination's analytics see the same platform tan attributes the
 * click to. Undefined for unknown tags.
 */
export const channelUtm = (tag?: string): { source: string; medium: string } | undefined =>
  tag && Object.hasOwn(CHANNELS, tag)
    ? {
        source: CHANNELS[tag as keyof typeof CHANNELS],
        medium: CHANNEL_MEDIUM[tag as keyof typeof CHANNELS],
      }
    : undefined;

export type SourceMethod = "channel" | "utm" | "clickid" | "ua" | "referer" | "none";

export interface Attribution {
  source: string;
  method: SourceMethod;
}

/** Signals available on a redirect request. */
export interface AttributionSignals {
  channel?: string;
  utmSource?: string;
  queryKeys?: string[];
  userAgent?: string;
  referer?: string;
}

const SOURCE_ALIASES: Record<string, string> = {
  ...CHANNELS,
  ...Object.fromEntries(Object.values(CHANNELS).map((name) => [name, name])),
  insta: "instagram",
  twitter: "x",
  "x.com": "x",
  linkedin_post: "linkedin",
  lnkd: "linkedin",
  facebook_post: "facebook",
  meta: "facebook",
  mail: "email",
  newsletter: "email",
};

/** Maps free-form source names ("IG", "Twitter") to a canonical one. */
export const normalizeSource = (raw: string): string => {
  const key = raw.trim().toLowerCase().slice(0, 64);
  return SOURCE_ALIASES[key] ?? key;
};

// Click IDs platforms append to outbound links.
const CLICK_IDS: Record<string, string> = {
  fbclid: "facebook",
  igshid: "instagram",
  twclid: "x",
  li_fat_id: "linkedin",
  ttclid: "tiktok",
  gclid: "google",
  msclkid: "bing",
};

// In-app browsers identify themselves in the User-Agent.
const IN_APP: [RegExp, string][] = [
  [/\bInstagram\b/, "instagram"],
  [/\bBarcelona\b/, "threads"],
  [/FBAN|FBAV|FB_IAB|FBIOS/, "facebook"],
  [/LinkedInApp/, "linkedin"],
  [/musical_ly|BytedanceWebview|TikTok/, "tiktok"],
  [/Snapchat/, "snapchat"],
  [/Pinterest/, "pinterest"],
  [/\bTwitter\b/, "x"],
];

// Referrer host suffix -> platform.
const REFERERS: [string, string][] = [
  ["t.co", "x"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["instagram.com", "instagram"],
  ["threads.net", "threads"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["reddit.com", "reddit"],
  ["tiktok.com", "tiktok"],
  ["pinterest.com", "pinterest"],
  ["snapchat.com", "snapchat"],
  ["t.me", "telegram"],
  ["web.whatsapp.com", "whatsapp"],
  ["mail.google.com", "email"],
  ["outlook.live.com", "email"],
  ["google.com", "google"],
  ["bing.com", "bing"],
  ["duckduckgo.com", "duckduckgo"],
];

const refererSource = (referer?: string): string | undefined => {
  if (!referer) return undefined;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return REFERERS.find(([d]) => host === d || host.endsWith(`.${d}`))?.[1];
};

/**
 * Best available source for a click, strongest signal first: explicit channel
 * tag, then UTM, platform click ID, in-app browser, referrer.
 */
export function detectSource(s: AttributionSignals): Attribution {
  if (s.channel && s.channel in CHANNELS) {
    return { source: CHANNELS[s.channel as keyof typeof CHANNELS], method: "channel" };
  }
  if (s.utmSource) return { source: normalizeSource(s.utmSource), method: "utm" };

  const clickId = s.queryKeys?.find((k) => k in CLICK_IDS);
  if (clickId) return { source: CLICK_IDS[clickId], method: "clickid" };

  const ua = s.userAgent ?? "";
  const inApp = IN_APP.find(([re]) => re.test(ua));
  if (inApp) return { source: inApp[1], method: "ua" };

  const ref = refererSource(s.referer);
  if (ref) return { source: ref, method: "referer" };

  return { source: "unknown", method: "none" };
}

// Link-preview fetchers and scrapers. Explicit names rather than a bare /bot/,
// which would also match phone models like "Cubot".
const BOT_UA =
  /facebookexternalhit|facebookcatalog|meta-externalagent|Twitterbot|LinkedInBot|Pinterestbot|Slackbot|Discordbot|TelegramBot|WhatsApp\/|Snapchat-Bot|redditbot|SkypeUriPreview|Embedly|Iframely|vkShare|Googlebot|bingbot|DuckDuckBot|YandexBot|Baiduspider|Applebot|AhrefsBot|SemrushBot|bot\/|\bcrawler\b|\bspider\b|\+https?:\/\/|HeadlessChrome|curl\/|Wget\/|python-requests|Go-http-client|okhttp|node-fetch|axios\//i;

/** True for crawlers and scripts; a missing User-Agent counts as a bot. */
export const isBot = (userAgent?: string): boolean => !userAgent || BOT_UA.test(userAgent);
