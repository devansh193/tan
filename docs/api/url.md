# URL API

Create, list, inspect and delete short links, plus the public redirect.

Conventions (base URL, bearer auth, error envelope) are in [auth.md](./auth.md#conventions-all-apis).

**Tenancy:** every `/api/urls` route acts on the session's **active organization**. Links are shared by all members of that org. Switch org with `POST /api/auth/organization/set-active` (see [organization.md](./organization.md)).

**Rate limits**

| Routes | Limit |
| --- | --- |
| `/api/urls/*` | `RATE_LIMIT_MAX` (default 100) per 15 min per IP |
| `GET /:code[/:channel]` | `REDIRECT_RATE_LIMIT_MAX` (default 600) per minute per IP |

## Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/urls` | ✓ | Create a short link |
| GET | `/api/urls` | ✓ | List the org's links (paginated) |
| GET | `/api/urls/:code/stats` | ✓ | Link details + click analytics |
| DELETE | `/api/urls/:code` | ✓ | Soft-delete a link |
| GET | `/:code` | – | Redirect to original URL |
| GET | `/:code/:channel` | – | Redirect, attributing the click to a platform |

### Common errors on authenticated routes

| Status | Code | When |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Missing/invalid bearer token |
| 403 | `FORBIDDEN` | Session has no active organization, or user is no longer a member of it |

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Authentication required" } }
```

```json
{ "error": { "code": "FORBIDDEN", "message": "No active organization. Select one to continue." } }
```

---

### Short link object

Returned by create, list and stats.

| Field | Type | Description |
| --- | --- | --- |
| `code` | string | Short code (custom alias or random 7-char code) |
| `shortUrl` | string | `BASE_URL/<code>` |
| `originalUrl` | string | Redirect target |
| `shareUrls` | object | Platform name → channel-tagged link (`/<code>/<tag>`) |
| `clickCount` | number | Total human clicks (bots excluded) |
| `expiresAt` | string \| null | ISO timestamp; after it the link returns `410` |
| `createdAt` | string | ISO timestamp |

**Channel tags** used in `shareUrls` and `/:code/:channel`:

| Tag | Platform | Tag | Platform | Tag | Platform |
| --- | --- | --- | --- | --- | --- |
| `ig` | instagram | `tt` | tiktok | `wa` | whatsapp |
| `fb` | facebook | `yt` | youtube | `tg` | telegram |
| `li` | linkedin | `rd` | reddit | `em` | email |
| `x` | x | `pin` | pinterest | `sms` | sms |
| `th` | threads | `sc` | snapchat | `qr` | qr |

---

### POST `/api/urls`

**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Body**

| Field | Required | Rules |
| --- | --- | --- |
| `url` | ✓ | `http`/`https` only, max 2048 chars, no `user:pass@`, must not point at this shortener's host. Checked against Google Safe Browsing when configured |
| `customAlias` | – | 3–32 chars of `A-Z a-z 0-9 _ -`. Reserved: `api`, `health`, `ready`, `favicon.ico`, `robots.txt` |
| `expiresAt` | – | ISO date-time in the future |

**Request** (minimal)

```json
{
  "url": "https://example.com/blog/launch"
}
```

**Response** `201`

```json
{
  "code": "MZ0cYuF",
  "shortUrl": "http://localhost:3000/MZ0cYuF",
  "originalUrl": "https://example.com/blog/launch",
  "shareUrls": {
    "instagram": "http://localhost:3000/MZ0cYuF/ig",
    "facebook": "http://localhost:3000/MZ0cYuF/fb",
    "linkedin": "http://localhost:3000/MZ0cYuF/li",
    "x": "http://localhost:3000/MZ0cYuF/x",
    "threads": "http://localhost:3000/MZ0cYuF/th",
    "tiktok": "http://localhost:3000/MZ0cYuF/tt",
    "youtube": "http://localhost:3000/MZ0cYuF/yt",
    "reddit": "http://localhost:3000/MZ0cYuF/rd",
    "pinterest": "http://localhost:3000/MZ0cYuF/pin",
    "snapchat": "http://localhost:3000/MZ0cYuF/sc",
    "whatsapp": "http://localhost:3000/MZ0cYuF/wa",
    "telegram": "http://localhost:3000/MZ0cYuF/tg",
    "email": "http://localhost:3000/MZ0cYuF/em",
    "sms": "http://localhost:3000/MZ0cYuF/sms",
    "qr": "http://localhost:3000/MZ0cYuF/qr"
  },
  "clickCount": 0,
  "expiresAt": null,
  "createdAt": "2026-10-07T15:50:29.341Z"
}
```

**Request** (custom alias + expiry)

```json
{
  "url": "https://example.com/sale",
  "customAlias": "promo",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

**Response** `201` — same shape, `"code": "promo"`, `"expiresAt": "2027-01-01T00:00:00.000Z"`.

**Errors**

| Status | Code | Message |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | `url: must be an http(s) URL` |
| 400 | `BAD_REQUEST` | `url: must not contain credentials` |
| 400 | `BAD_REQUEST` | `url: must not point to this shortener` |
| 400 | `BAD_REQUEST` | `customAlias: 3-32 chars: letters, digits, - or _` |
| 400 | `BAD_REQUEST` | `expiresAt: must be in the future` |
| 400 | `BAD_REQUEST` | `URL is flagged as unsafe` |
| 409 | `CONFLICT` | `Alias already taken` |
| 409 | `CONFLICT` | `Alias is reserved` |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 16 KB |

```json
{ "error": { "code": "CONFLICT", "message": "Alias already taken" } }
```

---

### GET `/api/urls`

Lists the active org's links, newest first.

**Query**

| Param | Default | Rules |
| --- | --- | --- |
| `limit` | 20 | 1–100 |
| `offset` | 0 | ≥ 0 |

```
GET /api/urls?limit=2&offset=0
```

**Response** `200` (`shareUrls` trimmed for brevity — always contains all 15 channels)

```json
{
  "items": [
    {
      "code": "promo",
      "shortUrl": "http://localhost:3000/promo",
      "originalUrl": "https://example.com/sale",
      "shareUrls": {
        "instagram": "http://localhost:3000/promo/ig",
        "linkedin": "http://localhost:3000/promo/li"
      },
      "clickCount": 3,
      "expiresAt": "2027-01-01T00:00:00.000Z",
      "createdAt": "2026-10-07T15:50:29.371Z"
    },
    {
      "code": "MZ0cYuF",
      "shortUrl": "http://localhost:3000/MZ0cYuF",
      "originalUrl": "https://example.com/blog/launch",
      "shareUrls": {
        "instagram": "http://localhost:3000/MZ0cYuF/ig",
        "linkedin": "http://localhost:3000/MZ0cYuF/li"
      },
      "clickCount": 0,
      "expiresAt": null,
      "createdAt": "2026-10-07T15:50:29.341Z"
    }
  ],
  "total": 2,
  "limit": 2,
  "offset": 0
}
```

**Errors:** `400 BAD_REQUEST` for out-of-range `limit`/`offset`.

---

### GET `/api/urls/:code/stats`

Link object plus per-source breakdown and the 20 most recent clicks. Bot/preview-crawler hits are not recorded.

```
GET /api/urls/promo/stats
```

**Response** `200` (`shareUrls` trimmed)

```json
{
  "code": "promo",
  "shortUrl": "http://localhost:3000/promo",
  "originalUrl": "https://example.com/sale",
  "shareUrls": { "instagram": "http://localhost:3000/promo/ig" },
  "clickCount": 3,
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "createdAt": "2026-10-07T15:50:29.371Z",
  "sources": [
    { "source": "email", "method": "utm", "clicks": 1 },
    { "source": "instagram", "method": "ua", "clicks": 1 },
    { "source": "linkedin", "method": "channel", "clicks": 1 }
  ],
  "recentClicks": [
    {
      "id": 31,
      "urlId": 15,
      "ip": "::",
      "country": null,
      "state": null,
      "city": null,
      "browser": "Firefox 130",
      "os": null,
      "device": "desktop",
      "referer": null,
      "utmSource": "newsletter",
      "utmMedium": "email",
      "utmCampaign": "oct",
      "source": "email",
      "sourceMethod": "utm",
      "createdAt": "2026-10-07T15:50:29.513Z"
    },
    {
      "id": 30,
      "urlId": 15,
      "ip": "::",
      "country": null,
      "state": null,
      "city": null,
      "browser": "Chrome 120",
      "os": null,
      "device": "desktop",
      "referer": null,
      "utmSource": null,
      "utmMedium": null,
      "utmCampaign": null,
      "source": "linkedin",
      "sourceMethod": "channel",
      "createdAt": "2026-10-07T15:50:29.502Z"
    }
  ]
}
```

- `ip` is anonymized: IPv4 → `/24` (`203.0.113.0`), IPv6 → `/48`.
- `country` / `state` / `city` come from a geo-IP lookup on the full IP (null for local/private IPs).
- `sourceMethod` — how `source` was determined, strongest first:

| Method | Signal |
| --- | --- |
| `channel` | Channel tag in path (`/promo/li`) |
| `utm` | `utm_source` query param (normalized, e.g. `newsletter` → `email`, `twitter` → `x`) |
| `clickid` | Platform click ID param (`fbclid`, `igshid`, `ttclid`, `gclid`, …) |
| `ua` | In-app browser User-Agent (Instagram, Facebook, TikTok, …) |
| `referer` | Referer host (`t.co`, `linkedin.com`, …) |
| `none` | Nothing matched → `source: "unknown"` |

**Errors:** `404 NOT_FOUND` — unknown code or belongs to another org.

---

### DELETE `/api/urls/:code`

Soft-deletes a link; it stops redirecting immediately. Members can delete only links they created; org `owner`/`admin` can delete any link in the org.

```
DELETE /api/urls/promo
```

**Response** `204` — no body.

**Errors**

| Status | Code | Message |
| --- | --- | --- |
| 403 | `FORBIDDEN` | `Only organization admins can delete other members' links` |
| 404 | `NOT_FOUND` | `Short link not found` |

---

### GET `/:code` and `/:code/:channel`

Public redirect. No auth.

```
GET /promo
GET /promo/ig
GET /promo?utm_source=newsletter&utm_medium=email&utm_campaign=oct
```

Query params on the short link are used for attribution only — they are **not** forwarded to the target.

**Response** `302`

```
HTTP/1.1 302 Found
Location: https://example.com/sale
Content-Type: text/plain; charset=utf-8

Found. Redirecting to https://example.com/sale
```

An unknown channel tag still redirects; attribution falls back to the other signals.

**Errors**

| Status | Code | Message |
| --- | --- | --- |
| 404 | `NOT_FOUND` | `Short link not found` (unknown, deleted, or invalid code) |
| 410 | `GONE` | `Short link has expired` |
| 429 | `RATE_LIMITED` | `Too many requests` |

```json
{ "error": { "code": "NOT_FOUND", "message": "Short link not found" } }
```
