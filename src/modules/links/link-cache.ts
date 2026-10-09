/** The fields a redirect needs. */
export interface CachedLink {
  id: number;
  originalUrl: string;
  expiresAt: Date | null;
  redirectType: 301 | 302;
  /** Share-tag clicks get that platform's utm_source/utm_medium. */
  autoUtm: boolean;
  /** Per-platform share links are offered; off = plain short link. */
  shareLinks: boolean;
}

const TTL_MS = 30_000;
const MAX_ENTRIES = 50_000;

/**
 * In-process LRU + TTL cache (L1) for redirect lookups. Stores misses as
 * `null` so code scans don't reach Redis or the DB; `get` returns `undefined`
 * when there is no entry at all.
 */
export class LinkCache {
  private readonly entries = new Map<string, { link: CachedLink | null; until: number }>();

  get(code: string): CachedLink | null | undefined {
    const hit = this.entries.get(code);
    if (!hit) return undefined;
    this.entries.delete(code);
    if (hit.until < Date.now()) return undefined;
    this.entries.set(code, hit); // re-insert = most recently used
    return hit.link;
  }

  set(code: string, link: CachedLink | null): void {
    this.entries.delete(code);
    this.entries.set(code, { link, until: Date.now() + TTL_MS });
    if (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  delete(code: string): void {
    this.entries.delete(code);
  }
}
