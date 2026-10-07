/** The fields a redirect needs. */
export interface CachedLink {
  id: number;
  originalUrl: string;
  expiresAt: Date | null;
}

const TTL_MS = 30_000;
const MAX_ENTRIES = 50_000;

/**
 * In-process LRU + TTL cache for redirect lookups, so hot links skip the DB.
 *
 * ponytail: per-process — a delete on another instance stays visible here for
 * up to TTL_MS. Move to Redis with pub/sub invalidation if that window matters.
 */
export class LinkCache {
  private readonly entries = new Map<string, { link: CachedLink; until: number }>();

  get(code: string): CachedLink | undefined {
    const hit = this.entries.get(code);
    if (!hit) return undefined;
    this.entries.delete(code);
    if (hit.until < Date.now()) return undefined;
    this.entries.set(code, hit); // re-insert = most recently used
    return hit.link;
  }

  set(code: string, link: CachedLink): void {
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
