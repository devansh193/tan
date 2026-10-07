import { describe, it, expect, vi } from "vitest";
import { ClickRecorder } from "../src/modules/analytics/click-recorder";
import type { ClickRow } from "../src/modules/analytics/analytics.repository";

const browser = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36",
};

describe("ClickRecorder", () => {
  it("batches buffered clicks into one write and drains on stop", async () => {
    const recordClicks = vi.fn<(rows: ClickRow[]) => Promise<void>>().mockResolvedValue();
    const recorder = new ClickRecorder({ recordClicks });
    recorder.enqueue(1, { ...browser, ip: "1.2.3.4" });
    recorder.enqueue(1, { ...browser, channel: "ig" });
    recorder.enqueue(2, browser);
    await recorder.stop();

    expect(recordClicks).toHaveBeenCalledOnce();
    const rows = recordClicks.mock.calls[0][0];
    expect(rows.map((r) => r.urlId)).toEqual([1, 1, 2]);
    expect(rows[0].ip).toBe("1.2.3.0");
    expect(rows[1]).toMatchObject({ source: "instagram", sourceMethod: "channel" });
  });

  it("drops link-preview crawlers instead of counting them", async () => {
    const recordClicks = vi.fn<(rows: ClickRow[]) => Promise<void>>().mockResolvedValue();
    const recorder = new ClickRecorder({ recordClicks });
    recorder.enqueue(1, { userAgent: "Twitterbot/1.0" });
    recorder.enqueue(1, { userAgent: "facebookexternalhit/1.1" });
    await recorder.stop();
    expect(recordClicks).not.toHaveBeenCalled();
  });

  it("swallows write failures so redirects are never affected", async () => {
    const recorder = new ClickRecorder({
      recordClicks: () => Promise.reject(new Error("db down")),
    });
    recorder.enqueue(1, browser);
    await expect(recorder.stop()).resolves.toBeUndefined();
  });
});
