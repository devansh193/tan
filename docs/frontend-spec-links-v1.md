# Frontend Spec — Link Management (v1, phase B)

> **For:** whoever builds the dashboard UI for creating, listing, searching, editing and deleting short links.
> **Covers:** every `/api/v1/links` endpoint, the public redirect, and the UI behaviour each one needs, with real request and response samples captured from the running backend.
> **Not covered here:** sign-up/sign-in and organizations (see [`frontend-spec.md`](./frontend-spec.md) §2–§4.3), analytics charts (see [`api/analytics.md`](./api/analytics.md)).

---

## 1. Basics

| Item         | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Base URL     | `http://localhost:3000` (dev)                                                             |
| Auth         | `Authorization: Bearer <session token>` on every `/api/v1/*` call                         |
| Scope        | Everything acts on the session's **active organization**                                  |
| Content type | `application/json` for request bodies                                                     |
| Rate limit   | `/api/v1/*`: 100 requests / 15 min per IP (`429 RATE_LIMITED`, see `RateLimit-*` headers) |

**Identity rule.** A link has two identifiers. Never mix them up:

| Field  | Example                         | Use it for                                                             | Can change? |
| ------ | ------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `id`   | `link_vxDadCbejVNce8SGulU3u170` | API paths (`/api/v1/links/:id`), app routes (`/links/:id`), React keys | Never       |
| `code` | `spring-launch`                 | Displaying the short URL only                                          | Yes (PATCH) |

**Error envelope** (all `/api/v1` and redirect errors):

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "title: String must contain at least 1 character(s)"
  }
}
```

Validation messages are `"<field>: <reason>"`. Split on the first `": "` to show the reason under that form field; messages without a field prefix go in a toast.

---

## 2. Endpoints at a glance

| Method | Path                | Purpose                                   | Who                                       |
| ------ | ------------------- | ----------------------------------------- | ----------------------------------------- |
| POST   | `/api/v1/links`     | Create a link                             | owner, admin, member                      |
| GET    | `/api/v1/links`     | List, paginate, search, filter by creator | owner, admin, member                      |
| GET    | `/api/v1/links/:id` | Read one link                             | owner, admin, member                      |
| PATCH  | `/api/v1/links/:id` | Edit a link (send only changed fields)    | owner, admin: any link · member: own only |
| DELETE | `/api/v1/links/:id` | Delete a link                             | owner, admin: any link · member: own only |
| GET    | `/:code[/:channel]` | Public redirect (not called by the UI)    | anyone                                    |
| GET    | `/robots.txt`       | Crawler rules (not called by the UI)      | anyone                                    |

---

## 3. The Link object

Returned by create, get, update, and inside list pages.

```json
{
  "id": "link_vxDadCbejVNce8SGulU3u170",
  "code": "spring-launch",
  "shortUrl": "http://localhost:3000/spring-launch",
  "url": "https://example.com/spring?ref=home&utm_source=newsletter&utm_medium=email&utm_campaign=spring_launch",
  "title": "Spring launch",
  "description": "Landing page for the spring campaign",
  "redirectType": 302,
  "utm": {
    "source": "newsletter",
    "medium": "email",
    "campaign": "spring_launch",
    "term": null,
    "content": null
  },
  "autoUtm": false,
  "shareUrls": {
    "instagram": "http://localhost:3000/spring-launch/ig",
    "facebook": "http://localhost:3000/spring-launch/fb",
    "linkedin": "http://localhost:3000/spring-launch/li",
    "x": "http://localhost:3000/spring-launch/x",
    "threads": "http://localhost:3000/spring-launch/th",
    "tiktok": "http://localhost:3000/spring-launch/tt",
    "youtube": "http://localhost:3000/spring-launch/yt",
    "reddit": "http://localhost:3000/spring-launch/rd",
    "pinterest": "http://localhost:3000/spring-launch/pin",
    "snapchat": "http://localhost:3000/spring-launch/sc",
    "whatsapp": "http://localhost:3000/spring-launch/wa",
    "telegram": "http://localhost:3000/spring-launch/tg",
    "email": "http://localhost:3000/spring-launch/em",
    "sms": "http://localhost:3000/spring-launch/sms",
    "qr": "http://localhost:3000/spring-launch/qr"
  },
  "clicks": 0,
  "createdBy": "b0Tpn5bqXx6S68NEerGv4T0EtOgBONwl",
  "expiresAt": "2030-01-01T00:00:00.000Z",
  "createdAt": "2026-10-08T04:53:31.124Z",
  "updatedAt": "2026-10-08T04:53:31.124Z"
}
```

| Field          | Type               | Notes                                                                                             |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `id`           | string             | Permanent. `link_` + 24 chars                                                                     |
| `code`         | string             | Path of the short URL. 3–32 chars `A-Z a-z 0-9 _ -`. Random 7 chars if not chosen                 |
| `shortUrl`     | string             | What users copy and share                                                                         |
| `url`          | string             | Destination, **including** any `utm_*` params                                                     |
| `title`        | string \| null     | Display name. Show `shortUrl` when null                                                           |
| `description`  | string \| null     | Free text, internal only                                                                          |
| `redirectType` | `301` \| `302`     | See §9                                                                                            |
| `utm`          | object             | Read back from `url`. Always has all 5 keys; `null` = not set                                     |
| `autoUtm`      | boolean            | Share-URL clicks get that platform's `utm_source`/`utm_medium` (§8.1). Default `false`            |
| `shareUrls`    | object             | One tagged URL per platform; clicks on them are attributed to that platform. `qr` is for QR codes |
| `clicks`       | number             | All-time total, bots excluded. Updates within ~1 s of a visit                                     |
| `createdBy`    | string             | User id of the creator. Compare with `session.user.id` for permissions (§10)                      |
| `expiresAt`    | ISO string \| null | After this the short URL returns 410                                                              |
| `createdAt`    | ISO string         | Millisecond precision                                                                             |
| `updatedAt`    | ISO string         | Changes on every successful PATCH                                                                 |

---

## 4. Create a link — `POST /api/v1/links`

### Request (all fields)

```http
POST /api/v1/links
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "url": "https://example.com/spring?ref=home",
  "code": "spring-launch",
  "title": "Spring launch",
  "description": "Landing page for the spring campaign",
  "expiresAt": "2030-01-01T00:00:00.000Z",
  "redirectType": 302,
  "utm": { "source": "newsletter", "medium": "email", "campaign": "spring_launch" }
}
```

### Request (minimal)

```json
{ "url": "https://example.com/pricing" }
```

### Fields

| Field          | Required | Rules                                                                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `url`          | yes      | `http://` or `https://`, ≤2048 chars, no `user:pass@`, not this shortener's own domain, passes Safe Browsing (if enabled) |
| `code`         | no       | 3–32 chars `A-Z a-z 0-9 _ -`. Not `api`, `health`, `ready`. Must be unused                                                |
| `title`        | no       | 1–200 chars after trimming                                                                                                |
| `description`  | no       | 1–1000 chars after trimming                                                                                               |
| `expiresAt`    | no       | ISO date in the future                                                                                                    |
| `redirectType` | no       | `301` or `302` (default `302`)                                                                                            |
| `utm`          | no       | Any of `source`, `medium`, `campaign`, `term`, `content`; each 1–200 chars. Merged into `url` (§8)                        |
| `autoUtm`      | no       | `true` / `false` (default `false`). See §8.1                                                                              |

Any other field → 400. Omit optional fields you don't need; don't send `""`.

### Response — `201 Created`

Headers include `Location: /api/v1/links/link_vxDadCbejVNce8SGulU3u170`. Body is the full Link (see §3; that sample is this exact request's response).

Minimal request response (abridged):

```json
{
  "id": "link_aswPlOnObu72MyNaNtwcCBbi",
  "code": "Se250Qb",
  "url": "https://example.com/pricing",
  "title": null,
  "redirectType": 302,
  "utm": { "source": null, "medium": null, "campaign": null, "term": null, "content": null }
}
```

### Errors

| HTTP | `message` (exact)                                      | Show it                                   |
| ---- | ------------------------------------------------------ | ----------------------------------------- |
| 400  | `url: must be an http(s) URL`                          | under URL                                 |
| 400  | `URL is flagged as unsafe` (no field prefix)           | under URL (map by text)                   |
| 400  | `url: too long after adding UTM parameters (max 2048)` | under the UTM builder                     |
| 400  | `title: String must contain at least 1 character(s)`   | under Title (blank input)                 |
| 400  | `expiresAt: must be in the future`                     | under Expiry                              |
| 400  | `redirectType: Invalid input`                          | (only if UI sends a bad value)            |
| 400  | `utm: Unrecognized key(s) in object: 'utm_source'`     | (UI bug: send `source`, not `utm_source`) |
| 400  | `Unrecognized key(s) in object: 'customAlias'`         | (UI bug: field is `code`)                 |
| 409  | `Code already taken`                                   | under Code                                |
| 409  | `Code is reserved`                                     | under Code                                |
| 403  | `No active organization. Select one to continue.`      | org picker                                |

---

## 5. List links — `GET /api/v1/links`

### Query parameters

| Param    | Default     | Values                                                                                         |
| -------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `limit`  | `20`        | 1–100                                                                                          |
| `sort`   | `createdAt` | `createdAt` or `clicks`                                                                        |
| `order`  | `desc`      | `desc` or `asc`                                                                                |
| `cursor` | —           | `nextCursor` from the previous response                                                        |
| `q`      | —           | Search, 1–100 chars. Case-insensitive match on code, title **or** URL. `%` and `_` are literal |
| `userId` | —           | Only links created by this user                                                                |

### Request examples

```http
GET /api/v1/links?limit=20                                   # newest first
GET /api/v1/links?sort=clicks&order=desc                     # most clicked
GET /api/v1/links?q=spring                                   # search
GET /api/v1/links?userId=b0Tpn5bqXx6S68NEerGv4T0EtOgBONwl    # "created by me"
GET /api/v1/links?limit=20&cursor=eyJrIjoi…                  # next page
```

### Response — `200 OK`

```json
{
  "data": [
    {
      "id": "link_jDBkSqs2gXK2Mk4aztPv9hnW",
      "code": "ZERYfmg",
      "title": "Summer sale",
      "...": "full Link"
    },
    { "id": "link_aswPlOnObu72MyNaNtwcCBbi", "code": "Se250Qb", "title": null, "...": "full Link" }
  ],
  "nextCursor": "eyJrIjoiMjAyNi0xMC0wOFQwNDo1MzozMS4xOTFaIiwiaWQiOiJsaW5rX2Fzd1BsT25PYnU3Mk15TmFOdHdjQ0JiaSJ9"
}
```

Next page with that cursor:

```json
{ "data": [{ "id": "link_vxDadCbejVNce8SGulU3u170", "...": "full Link" }], "nextCursor": null }
```

Search `q=spring`:

```json
{
  "data": [
    {
      "id": "link_vxDadCbejVNce8SGulU3u170",
      "code": "spring-launch",
      "title": "Spring launch",
      "...": ""
    }
  ],
  "nextCursor": null
}
```

Search `q=%` (matched literally, not as a wildcard):

```json
{
  "data": [{ "code": "ZERYfmg", "url": "https://blog.example.com/100%25-off", "...": "" }],
  "nextCursor": null
}
```

### Pagination rules (important)

- `nextCursor: null` means last page. There is **no total count**: use "Load more" or infinite scroll, not page numbers.
- Treat the cursor as an opaque string. Don't parse or build it.
- Keep `q`, `userId`, `sort`, `order` and `limit` identical while following a cursor. When any of them changes, drop the cursor and start from the first page.
- Clear the list and cursor when the active organization changes.
- With `sort=clicks`, a link whose clicks change while the user pages can move between pages; de-duplicate by `id` when appending.

### Errors

| HTTP | `message`                                         |
| ---- | ------------------------------------------------- |
| 400  | `cursor: invalid`                                 |
| 400  | `q: String must contain at most 100 character(s)` |
| 400  | `limit: Number must be less than or equal to 100` |

A blank `q` (only spaces) is rejected too: don't send `q` when the search box is empty.

---

## 6. Get one link — `GET /api/v1/links/:id`

```http
GET /api/v1/links/link_aswPlOnObu72MyNaNtwcCBbi
```

`200 OK` → full Link:

```json
{
  "id": "link_aswPlOnObu72MyNaNtwcCBbi",
  "code": "Se250Qb",
  "url": "https://example.com/pricing",
  "title": null,
  "updatedAt": "2026-10-08T04:53:31.191Z",
  "...": "other Link fields"
}
```

`404 NOT_FOUND` `Link not found` for an unknown id, a deleted link, or a link in another organization. Show a "Link not found" page.

---

## 7. Edit a link — `PATCH /api/v1/links/:id`

**JSON merge:** send only the fields that changed.

| You send           | Effect                                             |
| ------------------ | -------------------------------------------------- |
| field omitted      | unchanged                                          |
| field with a value | set to that value                                  |
| `null`             | cleared (`title`, `description`, `expiresAt` only) |

Accepts the same fields and rules as create. `url`, `code`, `redirectType` and `autoUtm` can't be `null`.

### Samples (each is a real request/response pair, applied in order to the same link)

**Rename and clear the description**

```json
{ "title": "Spring launch — v2", "description": null }
```

```json
{
  "title": "Spring launch — v2",
  "description": null,
  "updatedAt": "2026-10-08T04:53:44.296Z",
  "...": ""
}
```

**Change UTM only** (applies to the current `url`; `null` removes a param, other query params are kept)

```json
{ "utm": { "medium": null, "content": "hero_button" } }
```

```json
{
  "url": "https://example.com/spring?ref=home&utm_source=newsletter&utm_campaign=spring_launch&utm_content=hero_button",
  "utm": {
    "source": "newsletter",
    "medium": null,
    "campaign": "spring_launch",
    "term": null,
    "content": "hero_button"
  }
}
```

**New destination plus UTM** (UTM is applied to the _new_ URL; the old URL's `utm_*` values do not carry over)

```json
{ "url": "https://example.com/spring-2?ref=home", "utm": { "source": "x" } }
```

```json
{
  "url": "https://example.com/spring-2?ref=home&utm_source=x",
  "utm": { "source": "x", "medium": null, "campaign": null, "term": null, "content": null }
}
```

To keep existing UTM values when changing the URL, send the full set in `utm` as well.

**Switch to 301 and remove the expiry**

```json
{ "redirectType": 301, "expiresAt": null }
```

```json
{ "redirectType": 301, "expiresAt": null, "...": "" }
```

**Change the code**

```json
{ "code": "spring-26" }
```

```json
{ "code": "spring-26", "shortUrl": "http://localhost:3000/spring-26", "...": "" }
```

The old short URL stops working **immediately**:

```http
GET /spring-launch  →  404 {"error":{"code":"NOT_FOUND","message":"Short link not found"}}
```

Always confirm before saving a new code: _"Anyone using the old link /spring-launch will get a 'not found' page."_

### Response

`200 OK` with the full updated Link. Replace your cached copy with it; don't merge locally.

### Errors

| HTTP | `message` (exact)                                        | Cause                                           |
| ---- | -------------------------------------------------------- | ----------------------------------------------- |
| 400  | `body: at least one field is required`                   | Sent `{}`: disable Save until something changed |
| 400  | `url: Expected string, received null`                    | `null` on a non-clearable field                 |
| 400  | `expiresAt: must be in the future`                       | Past date                                       |
| 400  | `Unrecognized key(s) in object: 'customAlias'`           | Unknown field                                   |
| 403  | `Only organization admins can edit other members' links` | Member editing someone else's link              |
| 404  | `Link not found`                                         | Unknown, deleted or other org                   |
| 409  | `Code already taken`                                     | Code in use                                     |
| 409  | `Code is reserved`                                       | `api`, `health`, `ready`                        |

### Building the PATCH body

```ts
/** Only the fields that differ from the loaded link; "" → null for clearable fields. */
function buildPatch(original: Link, form: LinkForm): UpdateLinkBody {
  const body: UpdateLinkBody = {};
  const clearable = (v: string) => (v.trim() === "" ? null : v.trim());
  if (form.url !== stripUtm(original.url)) body.url = form.url;
  if (form.code !== original.code) body.code = form.code;
  if (clearable(form.title) !== original.title) body.title = clearable(form.title);
  if (clearable(form.description) !== original.description)
    body.description = clearable(form.description);
  const expiresAt = form.expiresAt ? new Date(form.expiresAt).toISOString() : null;
  if (expiresAt !== original.expiresAt) body.expiresAt = expiresAt;
  if (form.redirectType !== original.redirectType) body.redirectType = form.redirectType;
  const utm = diffUtm(original.utm, form.utm); // keys whose value changed; "" → null
  if (body.url !== undefined || Object.keys(utm).length) {
    // A new url drops the old utm_* values, so resend all of them.
    body.utm = body.url !== undefined ? nonEmpty(form.utm) : utm;
  }
  return body;
}
```

`stripUtm`, `diffUtm` and `nonEmpty` are small helpers: the edit form shows the destination without `utm_*` params and edits UTM separately (§8).

---

## 8. UTM builder

The backend stores UTM values **only inside `url`**. The `utm` object in responses is read back from it.

**Form layout:** one destination input plus five optional inputs (Source, Medium, Campaign, Term, Content).

**Edit form prefill:**

- Destination: `link.url` with `utm_*` params removed (`stripUtm`).
- UTM inputs: `link.utm.*` (`null` → empty).

**Live preview:** show the final URL under the inputs, computed the same way the server does:

```ts
const KEYS = ["source", "medium", "campaign", "term", "content"] as const;

/** Mirror of the server's applyUtm: other params kept, utm_* appended at the end. */
function previewUrl(destination: string, utm: Partial<Record<(typeof KEYS)[number], string>>) {
  const [base, hash = ""] = destination.split("#");
  const [path, query = ""] = base.split("?");
  const kept = query
    .split("&")
    .filter((p) => p && !/^utm_(source|medium|campaign|term|content)=/.test(p));
  const added = KEYS.filter((k) => utm[k]?.trim()).map(
    (k) => `utm_${k}=${encodeURIComponent(utm[k]!.trim())}`,
  );
  const q = [...kept, ...added].join("&");
  return `${path}${q ? `?${q}` : ""}${hash ? `#${hash}` : ""}`;
}
```

Warn when the preview exceeds 2048 characters (the server returns 400).

**Hints:**

- **Source:** where the traffic comes from (`newsletter`, `x`, `linkedin`).
- **Medium:** the channel type (`email`, `social`, `cpc`).
- **Campaign:** the campaign name (`spring_launch`).
- **Term:** paid-search keyword.
- **Content:** which ad or link variant (`hero_button`).

### 8.1 Channel-aware UTM (`autoUtm`)

Share URLs (`shareUrls.instagram` = `/code/ig`, …) tell **tan** which platform a click came from. `autoUtm: true` makes the redirect tell the **destination** too, by setting `utm_source` and `utm_medium` for that platform. The destination's analytics (Google Analytics, Shopify, …) then credit visits and orders to the same platform tan shows, from a single link.

| Share tag                                         | `utm_source`              | `utm_medium` |
| ------------------------------------------------- | ------------------------- | ------------ |
| `ig` `fb` `li` `x` `th` `tt` `yt` `rd` `pin` `sc` | platform (`instagram`, …) | `social`     |
| `wa` `tg`                                         | `whatsapp`, `telegram`    | `messaging`  |
| `em`                                              | `email`                   | `email`      |
| `sms`                                             | `sms`                     | `sms`        |
| `qr`                                              | `qr`                      | `offline`    |

- Those two values replace the link's own `utm.source`/`utm.medium` **for that click only**. `utm.campaign`, `utm.term`, `utm.content` and other query params are kept.
- The plain `shortUrl` (no tag) redirects to `url` unchanged.
- The stored `url` and `utm` in API responses never change: they show what was configured, not what each platform gets.

**Example** (a real capture from the integration test). Create once:

```json
{
  "url": "https://brewly.example/cold-brew?ref=launch",
  "utm": { "campaign": "coldbrew_launch" },
  "autoUtm": true
}
```

| Visitor opens         | Lands on                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `shareUrls.instagram` | `https://brewly.example/cold-brew?ref=launch&utm_campaign=coldbrew_launch&utm_source=instagram&utm_medium=social` |
| `shareUrls.email`     | `https://brewly.example/cold-brew?ref=launch&utm_campaign=coldbrew_launch&utm_source=email&utm_medium=email`      |
| `shortUrl`            | `https://brewly.example/cold-brew?ref=launch&utm_campaign=coldbrew_launch`                                        |

**UI:**

- A toggle in the UTM builder: **"Tag each share link with its platform"**, off by default.
- When it's on, grey out the Source and Medium inputs with the hint _"Filled in per platform when shared via a share button"_, and show the share panel's preview URLs with the platform values.
- Turning it on or off is a normal PATCH (`{ "autoUtm": true }`) and applies to the next click.

---

## 9. Redirect type (301 vs 302)

| `redirectType`  | Response headers on visit                                       | Trade-off                                                                                                                                                              |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `302` (default) | `302 Found`, `Cache-Control: private, max-age=0`                | Every visit is counted; edits apply on the next visit                                                                                                                  |
| `301`           | `301 Moved Permanently`, `Cache-Control: private, max-age=3600` | A browser that already visited goes straight to the destination for up to 1 hour: those repeat visits aren't counted, and edits reach that visitor up to an hour later |

Real captures:

```http
GET /spring-26                                   GET /Se250Qb
HTTP/1.1 301 Moved Permanently                   HTTP/1.1 302 Found
Cache-Control: private, max-age=3600             Cache-Control: private, max-age=0
Location: https://example.com/spring-2?ref=home&utm_source=x
                                                 Location: https://example.com/pricing
X-Robots-Tag: noindex, nofollow                  X-Robots-Tag: noindex, nofollow
```

**UI:** a toggle labelled "Permanent redirect (301)", off by default. Helper text: _"Slightly faster for repeat visitors, but repeat visits within an hour aren't counted and edits can take up to an hour to reach them."_

---

## 10. Permissions in the UI

| Action      | owner | admin | member                                       |
| ----------- | :---: | :---: | -------------------------------------------- |
| Create      |   ✓   |   ✓   | ✓                                            |
| List / view |   ✓   |   ✓   | ✓ (all of the org's links)                   |
| Edit        |   ✓   |   ✓   | only if `link.createdBy === session.user.id` |
| Delete      |   ✓   |   ✓   | only if `link.createdBy === session.user.id` |

Get the caller's role by matching `session.user.id` against `members[].userId` from `GET /api/auth/organization/get-full-organization`. Hide Edit and Delete where not allowed. The backend enforces it anyway:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Only organization admins can edit other members' links"
  }
}
```

---

## 11. Delete a link — `DELETE /api/v1/links/:id`

```http
DELETE /api/v1/links/link_aswPlOnObu72MyNaNtwcCBbi
```

`204 No Content`, empty body. The short URL returns 404 right away. Errors: `403` (member, not theirs: `Only organization admins can delete other members' links`), `404 Link not found`.

Confirm first: _"Delete /Se250Qb? The short link will stop working immediately."_

---

## 12. Public redirect (server-side, for reference)

The UI never calls these; users open `shortUrl` directly.

| Request                          | Result                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /:code`                     | 301 or 302 to `url` (per `redirectType`)                                                                                |
| `GET /:code/:channel` e.g. `/ig` | Same, and the click is attributed to that platform; with `autoUtm`, platform `utm_source`/`utm_medium` are added (§8.1) |
| unknown or deleted code          | `404 {"error":{"code":"NOT_FOUND","message":"Short link not found"}}`                                                   |
| expired link                     | `410 {"error":{"code":"GONE","message":"Short link has expired"}}`                                                      |
| `GET /robots.txt`                | `User-agent: *` / `Disallow: /api/`                                                                                     |

Every response on these routes carries `X-Robots-Tag: noindex, nofollow`, so short links never show up in search results. Social preview bots can still follow them.

Edits, renames and deletes take effect on the redirect immediately (no cache delay to explain to users), except for repeat visitors of a `301` link (§9).

---

## 13. Screens and checklists

### Links list (`/links`)

- [ ] Rows/cards: title (or short URL), short URL with copy button, destination (truncated, UTM params hidden or dimmed), clicks, created date, expiry badge, 301 badge
- [ ] Search box → `q`, debounced ~300 ms, omitted when empty; resets list and cursor
- [ ] "Created by me" toggle → `userId=session.user.id`
- [ ] Sort: Newest (`createdAt desc`), Oldest (`createdAt asc`), Most clicks (`clicks desc`)
- [ ] "Load more" with `nextCursor`; stop at `null`
- [ ] Empty states: "No links yet" vs "No links match '…'"
- [ ] Edit/Delete actions gated by §10

### Create (`/links/new` or modal)

- [ ] Destination URL (required)
- [ ] Custom code (optional) with format hint `3–32 chars, A-Z a-z 0-9 _ -`
- [ ] Title, description (optional)
- [ ] Expiry date-time (optional, future only)
- [ ] UTM builder with live preview (§8), including the "Tag each share link with its platform" toggle (`autoUtm`, §8.1)
- [ ] 301 toggle with helper text (§9)
- [ ] On 201: show `shortUrl` with copy button and share buttons from `shareUrls`; navigate to `/links/:id`
- [ ] Map `"field: reason"` 400s and the 409s to inline errors

### Detail / edit (`/links/:id`)

- [ ] Load with `GET /api/v1/links/:id`; 404 → "Link not found"
- [ ] Summary: short URL (copy), destination, clicks, created, updated, expires (or "Never"), redirect type
- [ ] Share panel from `shareUrls`; QR generated client-side from `shareUrls.qr`
- [ ] Edit form = create form prefilled (§8 prefill rules); Save disabled until something changed
- [ ] PATCH only changed fields (§7 `buildPatch`); "Remove expiry" sends `expiresAt: null`; clearing title/description sends `null`
- [ ] Confirm dialog before changing `code`
- [ ] Replace the cached link with the PATCH response
- [ ] Delete with confirmation → back to list
- [ ] Analytics: `GET /api/v1/analytics?linkId=<id>` (see [`api/analytics.md`](./api/analytics.md))

---

## 14. TypeScript types

```ts
type Platform =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "x"
  | "threads"
  | "tiktok"
  | "youtube"
  | "reddit"
  | "pinterest"
  | "snapchat"
  | "whatsapp"
  | "telegram"
  | "email"
  | "sms"
  | "qr";

type UtmKey = "source" | "medium" | "campaign" | "term" | "content";
type Utm = Record<UtmKey, string | null>;

interface Link {
  id: string;
  code: string;
  shortUrl: string;
  url: string;
  title: string | null;
  description: string | null;
  redirectType: 301 | 302;
  utm: Utm;
  autoUtm: boolean;
  shareUrls: Record<Platform, string>;
  clicks: number;
  createdBy: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

interface ListLinksQuery {
  limit?: number; // 1–100, default 20
  cursor?: string;
  sort?: "createdAt" | "clicks";
  order?: "asc" | "desc";
  q?: string; // 1–100 chars, omit when empty
  userId?: string;
}

interface CreateLinkBody {
  url: string;
  code?: string;
  title?: string;
  description?: string;
  expiresAt?: string; // ISO, future
  redirectType?: 301 | 302;
  utm?: Partial<Record<UtmKey, string>>;
  autoUtm?: boolean; // default false
}

/** Send only changed fields. null clears title/description/expiresAt and removes a utm param. */
interface UpdateLinkBody {
  url?: string;
  code?: string;
  title?: string | null;
  description?: string | null;
  expiresAt?: string | null;
  redirectType?: 301 | 302;
  utm?: Partial<Record<UtmKey, string | null>>;
  autoUtm?: boolean; // not nullable
}

interface ApiError {
  error: {
    code:
      | "BAD_REQUEST"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "GONE"
      | "RATE_LIMITED"
      | "INTERNAL";
    message: string;
  };
}
```

---

## 15. Minimal API client

```ts
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(body?.error?.message ?? "Something went wrong"), {
      status: res.status,
      code: body?.error?.code,
    });
  return body as T;
}

export const links = {
  create: (b: CreateLinkBody) =>
    api<Link>("/api/v1/links", { method: "POST", body: JSON.stringify(b) }),
  list: (q: ListLinksQuery) =>
    api<Page<Link>>(
      `/api/v1/links?${new URLSearchParams(
        Object.entries(q)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      )}`,
    ),
  get: (id: string) => api<Link>(`/api/v1/links/${id}`),
  update: (id: string, b: UpdateLinkBody) =>
    api<Link>(`/api/v1/links/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  remove: (id: string) => api<void>(`/api/v1/links/${id}`, { method: "DELETE" }),
};
```

---

_All samples were captured from the running backend on 2026-10-08 (host rewritten to `localhost:3000`). Endpoint reference: [`api/links.md`](./api/links.md). Request collections: `bruno/Links/`, `url-shortener.postman_collection.json`._
