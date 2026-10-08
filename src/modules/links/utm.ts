/** The five standard campaign parameters, stored on the destination URL as `utm_*`. */
export const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Record<UtmKey, string | null>;
/** A string sets the param, `null` removes it, an absent key leaves it alone. */
export type UtmPatch = Partial<Record<UtmKey, string | null>>;

const paramName = (pair: string): string => {
  const raw = pair.split("=", 1)[0].replace(/\+/g, " ");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * Applies a UTM patch to a URL. Other query params are kept byte-for-byte (no
 * re-encoding), so the destination never changes in ways the user didn't ask
 * for; patched `utm_*` params move to the end.
 */
export const applyUtm = (url: string, patch: UtmPatch): string => {
  const touched = UTM_KEYS.filter((k) => k in patch);
  if (!touched.length) return url;
  const names = new Set(touched.map((k) => `utm_${k}`));
  const u = new URL(url);
  const kept = u.search
    .slice(1)
    .split("&")
    .filter((pair) => pair && !names.has(paramName(pair)));
  const added = touched.flatMap((k) => {
    const value = patch[k];
    return value == null ? [] : [`utm_${k}=${encodeURIComponent(value)}`];
  });
  const query = [...kept, ...added].join("&");
  const base = url.split(/[?#]/, 1)[0];
  return `${base}${query ? `?${query}` : ""}${u.hash}`;
};

/** The UTM values on a URL (decoded), `null` where absent. */
export const readUtm = (url: string): Utm => {
  const params = new URL(url).searchParams;
  return Object.fromEntries(UTM_KEYS.map((k) => [k, params.get(`utm_${k}`)])) as Utm;
};
