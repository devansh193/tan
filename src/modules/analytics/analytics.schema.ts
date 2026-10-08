import { z } from "zod";

const DAY = 86_400_000;

/** Breakdown dimension → clicks column. A fixed whitelist: never interpolate user input. */
export const DIMENSIONS = {
  countries: "country",
  cities: "city",
  devices: "device",
  browsers: "browser",
  os: "os",
  referers: "referer",
  sources: "source",
} as const;

/** Filter param → clicks column. */
export const FILTERS = {
  country: "country",
  city: "city",
  device: "device",
  browser: "browser",
  os: "os",
  referer: "referer",
  source: "source",
} as const;

export type Dimension = keyof typeof DIMENSIONS;
export type Interval = "hour" | "day" | "month";

/** "a,b" → ["a", "b"]; bounded so one request can't build a huge IN list. */
const commaList = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().max(512)).min(1).max(100))
  .optional();

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** GET /api/v1/analytics. Defaults: last 30 days, interval by span, UTC. */
export const analyticsQuerySchema = z
  .object({
    groupBy: z
      .enum([
        "timeseries",
        "countries",
        "cities",
        "devices",
        "browsers",
        "os",
        "referers",
        "sources",
      ])
      .default("timeseries"),
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
    interval: z.enum(["hour", "day", "month"]).optional(),
    timezone: z.string().max(64).refine(isTimeZone, "must be an IANA time zone").default("UTC"),
    linkId: commaList,
    ...(Object.fromEntries(Object.keys(FILTERS).map((k) => [k, commaList])) as Record<
      keyof typeof FILTERS,
      typeof commaList
    >),
  })
  .transform(({ start, end, interval, ...rest }, ctx) => {
    const e = end ?? new Date();
    const s = start ?? new Date(e.getTime() - 30 * DAY);
    const span = e.getTime() - s.getTime();
    const fail = (path: string, message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      return z.NEVER;
    };
    if (span <= 0) return fail("start", "must be before end");
    if (span > 731 * DAY) return fail("start", "range must be at most 2 years");
    if (interval === "hour" && span > 31 * DAY)
      return fail("interval", "hour is only allowed for ranges up to 31 days");
    const auto: Interval = span <= 2 * DAY ? "hour" : span <= 90 * DAY ? "day" : "month";
    return { ...rest, start: s, end: e, interval: interval ?? auto };
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
