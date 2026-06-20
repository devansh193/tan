import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";

/** Request metadata captured on redirect. */
export interface RedirectMeta {
  ip?: string;
  referer?: string;
  userAgent?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
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
}

/** Builds click analytics from redirect request metadata. */
export function buildClickData(meta: RedirectMeta): ClickData {
  const geo = meta.ip ? geoip.lookup(meta.ip) : null;
  const ua = new UAParser(meta.userAgent);
  const browser = ua.getBrowser();
  const os = ua.getOS();
  const device = ua.getDevice();
  const fromReferer = extractUtmFromUrl(meta.referer);

  return {
    ip: meta.ip,
    country: geo?.country ?? undefined,
    state: geo?.region ?? undefined,
    city: geo?.city ?? undefined,
    browser: formatNameVersion(browser.name, browser.version),
    os: formatNameVersion(os.name, os.version),
    device: formatDevice(device, meta.userAgent),
    referer: meta.referer,
    utmSource: meta.utmSource ?? fromReferer.source,
    utmMedium: meta.utmMedium ?? fromReferer.medium,
    utmCampaign: meta.utmCampaign ?? fromReferer.campaign,
  };
}

function formatNameVersion(name?: string, version?: string): string | undefined {
  if (!name) return undefined;
  return version ? `${name} ${version}` : name;
}

function formatDevice(
  device: UAParser.IDevice,
  userAgent?: string,
): string | undefined {
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
