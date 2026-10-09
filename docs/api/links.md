# Links API (v1)

All routes require `Authorization: Bearer <session token>` and act on the
session's active organization. Errors use `{ "error": { "code", "message" } }`.

## Resource

```json
{
  "id": "link_8fK2mQ9xLr0aTzW3bN7cYv1D",
  "code": "abc1234",
  "shortUrl": "http://localhost:3000/abc1234",
  "url": "https://example.com/landing?utm_source=news",
  "title": "Launch post",
  "description": null,
  "redirectType": 302,
  "utm": { "source": "news", "medium": null, "campaign": null, "term": null, "content": null },
  "autoUtm": false,
  "shareLinks": true,
  "shareUrls": { "instagram": "http://localhost:3000/abc1234/ig", "...": "..." },
  "clicks": 0,
  "createdBy": "<user id>",
  "expiresAt": null,
  "createdAt": "2026-10-08T10:00:00.123Z",
  "updatedAt": "2026-10-08T10:00:00.123Z"
}
```

`id` is permanent. `code` is the short URL's path segment. `utm` is read back
from `url`: the URL is the only place UTM values are stored.

## Endpoints

| Method | Path                | Permission  | Success            |
| ------ | ------------------- | ----------- | ------------------ |
| POST   | `/api/v1/links`     | link:create | `201` + `Location` |
| GET    | `/api/v1/links`     | link:read   | `200` page         |
| GET    | `/api/v1/links/:id` | link:read   | `200`              |
| PATCH  | `/api/v1/links/:id` | link:update | `200`              |
| DELETE | `/api/v1/links/:id` | link:delete | `204`              |

### POST /api/v1/links

```json
{
  "url": "https://example.com",
  "code": "promo",
  "title": "Launch post",
  "description": "Spring campaign landing page",
  "expiresAt": "2030-01-01T00:00:00Z",
  "redirectType": 302,
  "utm": { "source": "newsletter", "medium": "email", "campaign": "launch" },
  "autoUtm": false,
  "shareLinks": true
}
```

- `url`: http(s) only, ≤2048 chars, no embedded credentials, not this
  shortener, and passes Safe Browsing when configured.
- `code` (optional): 3–32 chars `A–Z a–z 0–9 _ -`. Reserved words return
  `409`, and a code already in use returns `409`.
- `title` (optional): ≤200 chars. `description` (optional): ≤1000 chars.
  Both are trimmed and can't be blank.
- `expiresAt` (optional): a future ISO date. An expired link returns `410`.
- `redirectType` (optional): `301` or `302` (default `302`). See
  [Redirect](#redirect) for the trade-off.
- `utm` (optional): any of `source`, `medium`, `campaign`, `term`, `content`
  (each ≤200 chars). They are merged into `url` as `utm_*` params; every other
  query param is kept exactly as sent. The resulting URL must stay ≤2048
  chars (`400` otherwise).
- `autoUtm` (optional, default `false`): when `true`, clicks on a share URL
  (`/code/ig`, `/code/li`, …) reach the destination with that platform's
  `utm_source`/`utm_medium`. See [Channel-aware UTM](#channel-aware-utm-autoutm).
  Requires `shareLinks` (`400` otherwise).
- `shareLinks` (optional, default `true`): offer per-platform share URLs. When
  `false` the link is a plain short link and `shareUrls` is `{}`.
- Unknown fields are rejected with `400`.

### GET /api/v1/links

| Query    | Default     | Notes                                                                                  |
| -------- | ----------- | -------------------------------------------------------------------------------------- |
| `limit`  | 20          | 1–100                                                                                  |
| `sort`   | `createdAt` | `createdAt` or `clicks`                                                                |
| `order`  | `desc`      | `asc` or `desc`                                                                        |
| `cursor` | —           | `nextCursor` from the previous page                                                    |
| `q`      | —           | 1–100 chars; matches code, title or URL; case-insensitive; `%` and `_` match literally |
| `userId` | —           | only links created by this user                                                        |

```json
{ "data": [], "nextCursor": "eyJrIjoi…" }
```

`nextCursor` is `null` on the last page. Cursors are opaque, and a malformed
one returns `400`. Keep `q`, `userId`, `sort` and `order` the same while
following a cursor. There is no total count.

### GET /api/v1/links/:id

Returns the link. A link in another organization, or an unknown id, returns
`404`.

### PATCH /api/v1/links/:id

JSON merge: send only the fields to change.

```json
{
  "url": "https://example.com/v2",
  "title": null,
  "expiresAt": null,
  "utm": { "source": "x", "medium": null }
}
```

- Accepts the same fields as create. An omitted field is unchanged.
- `null` clears `title`, `description` or `expiresAt`. `url`, `code`,
  `redirectType`, `autoUtm` and `shareLinks` can't be `null`.
- `shareLinks: false` also sets `autoUtm` to `false`. `autoUtm: true` on a link
  without share links returns `400`.
- `utm`: a value sets that param and `null` removes it. It applies to the new
  `url` if both are sent, otherwise to the current one.
- Changing `code` frees the old code immediately: anything already shared with
  the old short URL stops working (`404`).
- Changes reach redirects at once on every server instance.
- An empty body or unknown fields return `400`.
- Owners and admins can edit any link. Members can edit only links they
  created (`403` otherwise). A link in another organization, or an unknown id,
  returns `404`.

### DELETE /api/v1/links/:id

Owners and admins can delete any link. Members can delete only links they
created (`403` otherwise). A link in another organization, or an unknown id,
returns `404`.

## Redirect

`GET /:code` and `GET /:code/:channel` redirect to `url` with the link's
`redirectType`. They return `404` when unknown and `410` when expired. Clicks
from bots and link-preview crawlers are not counted.

| `redirectType` | `Cache-Control`         | Effect                                                                                                                                                             |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `302`          | `private, max-age=0`    | Every visit reaches the server and is counted. Edits apply on the next visit.                                                                                      |
| `301`          | `private, max-age=3600` | Browsers reuse the redirect for up to an hour: repeat visits in that hour aren't counted, and an edit can take up to an hour to reach someone who already visited. |

### Channel-aware UTM (`autoUtm`)

Share URLs tell tan which platform a click came from. With `autoUtm: true`
the redirect also tells the destination, so its analytics (Google Analytics,
Shopify, …) attribute visits and orders to the same platform:

| Share tag                                         | `utm_source`              | `utm_medium` |
| ------------------------------------------------- | ------------------------- | ------------ |
| `ig` `fb` `li` `x` `th` `tt` `yt` `rd` `pin` `sc` | platform (`instagram`, …) | `social`     |
| `wa` `tg`                                         | `whatsapp`, `telegram`    | `messaging`  |
| `em`                                              | `email`                   | `email`      |
| `sms`                                             | `sms`                     | `sms`        |
| `qr`                                              | `qr`                      | `offline`    |

These two values replace the link's own `utm.source`/`utm.medium` for that
click; `utm.campaign`, `utm.term`, `utm.content` and every other query param
are kept. The plain short URL (no tag) and unknown tags redirect to `url`
unchanged. The stored `url` and the `utm` object in responses never change.

Example, link `url` = `https://brewly.example/cold-brew?utm_campaign=coldbrew_launch`:

| Visitor opens  | Redirected to                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `/coldbrew/ig` | `https://brewly.example/cold-brew?utm_campaign=coldbrew_launch&utm_source=instagram&utm_medium=social` |
| `/coldbrew/em` | `https://brewly.example/cold-brew?utm_campaign=coldbrew_launch&utm_source=email&utm_medium=email`      |
| `/coldbrew`    | `https://brewly.example/cold-brew?utm_campaign=coldbrew_launch`                                        |

With `autoUtm` on, set only `utm.campaign` (plus `content`/`term` if useful)
on the link and let the share tag supply source and medium.

Every response on these routes carries `X-Robots-Tag: noindex, nofollow`, so
short links never appear in search results. `GET /robots.txt` blocks only
`/api/`: short links stay crawlable so link-preview bots (X, LinkedIn, Slack)
can follow them and see the noindex header.
