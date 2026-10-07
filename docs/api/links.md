# Links API (v1)

All routes require `Authorization: Bearer <session token>` and act on the
session's active organization. Errors use `{ "error": { "code", "message" } }`.

## Resource

```json
{
  "id": "link_8fK2mQ9xLr0aTzW3bN7cYv1D",
  "code": "abc1234",
  "shortUrl": "http://localhost:3000/abc1234",
  "url": "https://example.com/landing",
  "shareUrls": { "instagram": "http://localhost:3000/abc1234/ig", "...": "..." },
  "clicks": 0,
  "createdBy": "<user id>",
  "expiresAt": null,
  "createdAt": "2026-10-08T10:00:00.123Z"
}
```

`id` is permanent. `code` is the short URL's path segment.

## Endpoints

| Method | Path                | Permission  | Success            |
| ------ | ------------------- | ----------- | ------------------ |
| POST   | `/api/v1/links`     | link:create | `201` + `Location` |
| GET    | `/api/v1/links`     | link:read   | `200` page         |
| GET    | `/api/v1/links/:id` | link:read   | `200`              |
| DELETE | `/api/v1/links/:id` | link:delete | `204`              |

### POST /api/v1/links

```json
{ "url": "https://example.com", "code": "promo", "expiresAt": "2030-01-01T00:00:00Z" }
```

- `url`: http(s) only, ≤2048 chars, no embedded credentials, not this
  shortener, and passes Safe Browsing when configured.
- `code` (optional): 3–32 chars `A–Z a–z 0–9 _ -`. Reserved words return
  `409`, and a code already in use returns `409`.
- `expiresAt` (optional): a future ISO date. An expired link returns `410`.
- Unknown fields are rejected with `400`.

### GET /api/v1/links

| Query    | Default     | Notes                               |
| -------- | ----------- | ----------------------------------- |
| `limit`  | 20          | 1–100                               |
| `sort`   | `createdAt` | `createdAt` or `clicks`             |
| `order`  | `desc`      | `asc` or `desc`                     |
| `cursor` | —           | `nextCursor` from the previous page |

```json
{ "data": [], "nextCursor": "eyJrIjoi…" }
```

`nextCursor` is `null` on the last page. Cursors are opaque, and a malformed
one returns `400`. There is no total count.

### GET /api/v1/links/:id

Returns the link. A link in another organization, or an unknown id, returns
`404`.

### DELETE /api/v1/links/:id

Owners and admins can delete any link. Members can delete only links they
created (`403` otherwise). A link in another organization, or an unknown id,
returns `404`.

## Redirect

`GET /:code` and `GET /:code/:channel` → `302` to `url`. Returns `404` when
unknown and `410` when expired. Clicks from bots and link-preview crawlers are
not counted.
