import { logger } from "../../common/logger";
import { isBot } from "./attribution";
import { buildClickData, type RedirectMeta } from "./click-analytics";
import type { ClickRow, UrlRepository } from "./url.repository";

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_AT = 500;
const MAX_BUFFERED = 10_000;

interface PendingClick {
  urlId: number;
  meta: RedirectMeta;
  at: Date;
}

/**
 * Buffers clicks in memory and writes them in batches, keeping the redirect
 * path free of DB writes and bounding DB load under spikes.
 *
 * ponytail: in-process buffer — a crash loses up to ~1s of clicks, and a
 * failed flush drops its batch. Move to a durable queue (Redis stream, Kafka)
 * if analytics must be exact.
 */
export class ClickRecorder {
  private buffer: PendingClick[] = [];
  private flushing: Promise<void> | null = null;
  private dropped = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly repo: Pick<UrlRepository, "recordClicks">) {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  /** Queues a click; never blocks or throws. Sheds load past MAX_BUFFERED. */
  enqueue(urlId: number, meta: RedirectMeta): void {
    if (this.buffer.length >= MAX_BUFFERED) {
      this.dropped++;
      return;
    }
    this.buffer.push({ urlId, meta, at: new Date() });
    if (this.buffer.length >= FLUSH_AT) void this.flush();
  }

  /** Writes everything buffered so far. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.dropped) {
      logger.warn({ dropped: this.dropped }, "Click buffer full; clicks dropped");
      this.dropped = 0;
    }
    if (!this.buffer.length) return;

    const batch = this.buffer;
    this.buffer = [];
    // UA/geo parsing happens here, off the redirect path. Link-preview
    // crawlers and scripts aren't clicks, so they're not recorded or counted.
    const rows: ClickRow[] = batch
      .filter((c) => !isBot(c.meta.userAgent))
      .map((c) => ({ urlId: c.urlId, createdAt: c.at, ...buildClickData(c.meta) }));
    if (!rows.length) return;
    this.flushing = this.repo
      .recordClicks(rows)
      .catch((err) => logger.error({ err, count: rows.length }, "Failed to record clicks"))
      .finally(() => (this.flushing = null));
    return this.flushing;
  }

  /** Stops the timer and drains the buffer (graceful shutdown). */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
    await this.flush(); // anything enqueued while the first flush ran
  }
}
