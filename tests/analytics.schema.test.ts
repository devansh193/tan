import { describe, it, expect } from "vitest";
import { analyticsQuerySchema } from "../src/modules/analytics/analytics.schema";

const parse = (q: Record<string, string>) => analyticsQuerySchema.safeParse(q);
const DAY = 86_400_000;

describe("analyticsQuerySchema", () => {
  it("defaults to a 30-day daily UTC time series", () => {
    const q = analyticsQuerySchema.parse({});
    expect(q.groupBy).toBe("timeseries");
    expect(q.timezone).toBe("UTC");
    expect(q.interval).toBe("day");
    expect(q.end.getTime() - q.start.getTime()).toBe(30 * DAY);
  });

  it("picks the interval from the span", () => {
    const end = "2026-06-01T00:00:00Z";
    const at = (days: number) =>
      analyticsQuerySchema.parse({
        start: new Date(Date.parse(end) - days * DAY).toISOString(),
        end,
      }).interval;
    expect(at(2)).toBe("hour");
    expect(at(90)).toBe("day");
    expect(at(91)).toBe("month");
  });

  it("rejects bad ranges, hourly over 31 days, and unknown zones or dimensions", () => {
    expect(parse({ start: "2026-02-01", end: "2026-01-01" }).success).toBe(false);
    expect(parse({ start: "2020-01-01", end: "2026-01-01" }).success).toBe(false);
    expect(parse({ start: "2026-01-01", end: "2026-03-01", interval: "hour" }).success).toBe(false);
    expect(parse({ timezone: "Mars/Base" }).success).toBe(false);
    expect(parse({ groupBy: "ip" }).success).toBe(false);
    expect(parse({ timezone: "Asia/Kolkata", groupBy: "sources" }).success).toBe(true);
  });

  it("splits comma lists for link ids and filters", () => {
    const q = analyticsQuerySchema.parse({ linkId: "link_a, link_b", country: "IN" });
    expect(q.linkId).toEqual(["link_a", "link_b"]);
    expect(q.country).toEqual(["IN"]);
    expect(parse({ linkId: "," }).success).toBe(false);
  });
});
