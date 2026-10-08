# Analytics API (v1)

`GET /api/v1/analytics` — requires `Authorization: Bearer <session token>`,
an active organization and `analytics:read` (every role). Counts only clicks
on the organization's live links; bots and link-preview crawlers are never
recorded. Errors use `{ "error": { "code", "message" } }`.

## Query

| Param                                                             | Default      | Values                                                                                   |
| ----------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `groupBy`                                                         | `timeseries` | `timeseries`, `countries`, `cities`, `devices`, `browsers`, `os`, `referers`, `sources`  |
| `start`, `end`                                                    | last 30 days | ISO datetimes; `start < end`, span at most 2 years                                       |
| `interval`                                                        | by span      | `hour` (≤ 2 days), `day` (≤ 90 days), `month`; `hour` is rejected for spans over 31 days |
| `timezone`                                                        | `UTC`        | IANA name, e.g. `Asia/Kolkata`; buckets align to it                                      |
| `linkId`                                                          | all links    | comma list of link ids (`link_…`)                                                        |
| `country`, `city`, `device`, `browser`, `os`, `referer`, `source` | —            | comma lists; `browser` and `os` match by name without version (`Chrome`, `macOS`)        |

Invalid params → `400` with `"<param>: <reason>"`.

## Responses

Time series, one bucket per interval with gaps filled by zeros. `start` is the
bucket start, ISO with offset:

```json
{ "data": [{ "start": "2026-10-08T03:00:00+00:00", "clicks": 6, "uniques": 1 }] }
```

Breakdowns, top 100 by clicks; a missing value is `"unknown"`:

```json
{ "data": [{ "value": "Chrome", "clicks": 6, "uniques": 1 }] }
```

`groupBy=sources` also splits by attribution `method`: `channel` and `utm` are
exact, `clickid`, `ua` and `referer` are inferred, `none` is unattributed.

```json
{ "data": [{ "value": "instagram", "method": "channel", "clicks": 2, "uniques": 1 }] }
```

`uniques` are visitor-days: a visitor counted once per link per day, estimated
from the anonymised IP and user agent.

## Notes

- Computed from raw clicks. Phase D moves this onto `click_rollups` and hashed
  `visitor_days` behind the same contract.
- Shares the `/api/v1/*` rate limit (100 requests / 15 min per IP).
