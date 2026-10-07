import { isIPv4, isIPv6 } from "node:net";
import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import { detectSource, type SourceMethod } from "./attribution";

/** Request metadata captured on redirect. */
export interface RedirectMeta {
  ip?: string;
  referer?: string;
  userAgent?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** Channel tag from the share link path (`/abc1234/ig`). */
  channel?: string;
  /** Query parameter names on the short link (for platform click IDs). */
  queryKeys?: string[];
}

/** Parsed click row fields persisted to the database. */
export interface ClickData {
  ip?: string;
  country?: string;
  state?: string;
  city?: string;
  browser?: string;
  os?: string;
  device?: string;
  referer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  source?: string;
  sourceMethod?: SourceMethod;
}

/**
 * Drops the host part of an IP (IPv4 -> /24, IPv6 -> /48) so stored analytics
 * aren't personal data. Geo lookup uses the full IP before this runs.
 */
export function anonymizeIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIPv4(v4)) return v4.replace(/\.\d+$/, ".0");
  if (!isIPv6(ip)) return undefined;
  // Expand "::" so the first three hextets are explicit, then zero the rest.
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  // Round-trip through URL to get the canonical compressed form.
  return new URL(`http://[${full.slice(0, 3).join(":")}::]`).hostname.slice(1, -1);
}

/** Builds click analytics from redirect request metadata. */
export function buildClickData(meta: RedirectMeta): ClickData {
  const geo = meta.ip ? geoip.lookup(meta.ip) : null;
  const ua = new UAParser(meta.userAgent);
  const browser = ua.getBrowser();
  const os = ua.getOS();
  const device = ua.getDevice();
  const fromReferer = extractUtmFromUrl(meta.referer);
  const utmSource = meta.utmSource ?? fromReferer.source;
  const { source, method } = detectSource({ ...meta, utmSource });

  return {
    ip: anonymizeIp(meta.ip),
    country: geo?.country ?? undefined,
    state: geo?.region ?? undefined,
    city: geo?.city ?? undefined,
    browser: formatNameVersion(browser.name, browser.version),
    os: formatNameVersion(os.name, os.version),
    device: formatDevice(device, meta.userAgent),
    referer: meta.referer,
    utmSource,
    utmMedium: meta.utmMedium ?? fromReferer.medium,
    utmCampaign: meta.utmCampaign ?? fromReferer.campaign,
    source,
    sourceMethod: method,
  };
}

function formatNameVersion(name?: string, version?: string): string | undefined {
  if (!name) return undefined;
  return version ? `${name} ${version}` : name;
}

function formatDevice(device: UAParser.IDevice, userAgent?: string): string | undefined {
  if (device.type) return device.type;
  return userAgent ? "desktop" : undefined;
}

function extractUtmFromUrl(url?: string): {
  source?: string;
  medium?: string;
  campaign?: string;
} {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    return {
      source: parsed.searchParams.get("utm_source") ?? undefined,
      medium: parsed.searchParams.get("utm_medium") ?? undefined,
      campaign: parsed.searchParams.get("utm_campaign") ?? undefined,
    };
  } catch {
    return {};
  }
}
