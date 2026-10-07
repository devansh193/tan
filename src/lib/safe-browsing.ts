import { BadRequestError } from "../common/errors";
import { logger } from "../common/logger";
import { env } from "../config/env";

const ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

/**
 * Rejects URLs Google Safe Browsing flags as malware/phishing/unwanted.
 * No-op without SAFE_BROWSING_API_KEY. Fails open (logs) if the API is down,
 * so an outage there doesn't stop link creation.
 */
export async function assertSafeUrl(url: string): Promise<void> {
  if (!env.SAFE_BROWSING_API_KEY) return;

  let matched = false;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      // Header, not ?key=, so the key never lands in proxy/access logs.
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.SAFE_BROWSING_API_KEY },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        client: { clientId: "tan", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: [
            "MALWARE",
            "SOCIAL_ENGINEERING",
            "UNWANTED_SOFTWARE",
            "POTENTIALLY_HARMFUL_APPLICATION",
          ],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
    });
    if (!res.ok) throw new Error(`Safe Browsing HTTP ${res.status}`);
    const body = (await res.json()) as { matches?: unknown[] };
    matched = !!body.matches?.length;
  } catch (err) {
    logger.warn({ err }, "Safe Browsing check failed; allowing URL");
  }
  if (matched) throw new BadRequestError("URL is flagged as unsafe");
}
