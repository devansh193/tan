# Frontend Specification — URL Shortener (tan)

> **Purpose:** This document is a complete handoff for an AI agent (or human developer) building the frontend for **tan**, a multi-tenant URL shortener. The backend already exists; build a SPA or SSR app that consumes these APIs.
>
> **Full endpoint reference with real request/response samples:** [`docs/api/auth.md`](./api/auth.md), [`docs/api/links.md`](./api/links.md), [`docs/api/organization.md`](./api/organization.md). This spec covers FE behavior; those files are the source of truth for payload shapes.

---

## 1. Product Overview

**tan** is a URL shortener with:

- Email/password authentication (Better Auth)
- Multi-tenant **organizations** — every user gets a personal org on sign-up; teams can create orgs and invite members
- Org-scoped short links (versioned API `/api/v1/links`) with optional custom codes and expiry
- Click analytics (geo, device, browser, UTM, referer) with **per-platform source attribution** (Instagram, LinkedIn, X, …); bot/link-preview hits excluded
- Per-platform **share links** from a single short link (`/{code}/ig`, `/{code}/li`, …)
- Public redirect at `/{code}` or `/{code}/{channel}` (302 to original URL)

**Backend base URL (dev):** `http://localhost:3000`

**API status.** The links API is `v1`. Shipped today: create, list (cursor pagination, search, creator filter), get, edit (`PATCH`) and delete links, plus an interim analytics endpoint (`GET /api/v1/analytics`, see [`docs/api/analytics.md`](./api/analytics.md)). Coming in later v1 releases, each additive (existing fields keep their meaning):

| Next        | Adds                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| Tags        | `/api/v1/tags`, `tagIds` on links, tag filter                                    |
| Analytics   | pre-aggregated rollups behind the same `GET /api/v1/analytics` (faster at scale) |
| QR codes    | `GET /api/v1/links/:id/qr` (SVG/PNG, colors), QR scans vs clicks                 |
| Viewer role | read-only `viewer` organization role                                             |

Build the UI so these slot in, but don't call them until they ship.

**Frontend should run separately** (e.g. `http://localhost:5173`) and talk to the API via CORS. Set `CORS_ORIGINS` on the backend to include the FE origin in production.

---

## 2. Architecture Decisions for the Frontend

### 2.1 Auth model — Bearer token, not cookies

The backend uses Better Auth with the **bearer plugin**. There are **no cookie-based sessions** for API clients.

| Event                  | What to do                                                                                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign up / Sign in      | Read the **`set-auth-token` response header** (not the body's `token` field — the header value is the signed token). Store it securely (memory, `sessionStorage`, or httpOnly cookie via a BFF if you add one later). The header must be readable cross-origin (exposed by Better Auth's bearer plugin). |
| Authenticated requests | Send `Authorization: Bearer <sessionToken>` on every protected call.                                                                                                                                                                                                                                     |
| Sign out               | `POST /api/auth/sign-out` with the bearer token, then clear stored token.                                                                                                                                                                                                                                |

Session lifetime: **7 days**, refreshed every 24h of activity.

**Origin header / cookies:** if requests carry the `better-auth.session_token` cookie (e.g. `credentials: "include"`), Better Auth rejects any `/api/auth/*` request without a trusted `Origin` with `403 MISSING_OR_NULL_ORIGIN`. Browsers send `Origin` automatically on cross-origin requests, so this mainly bites non-browser clients. Simplest: use bearer only and don't send credentials.

### 2.2 Recommended client library

Use **`better-auth` client** with the bearer plugin, or plain `fetch` with a thin auth wrapper. The backend mounts all auth at `/api/auth/*`.

```ts
// Example env
VITE_API_URL=http://localhost:3000
```

### 2.3 Multitenancy — active organization

All link management (`/api/v1/*`) is scoped to the user's **active organization** on their session.

- On sign-up, the backend auto-creates a personal org (`"{name}'s Organization"`, user is `owner`).
- **Gotcha:** the session returned by **sign-up** is created _before_ that org exists, so it has `activeOrganizationId: null`. Every **sign-in** session is pinned to the user's first org automatically.
- Users can belong to multiple orgs; they **switch** via `POST /api/auth/organization/set-active`.
- Accepting an invitation or creating an org (unless `keepCurrentActiveOrganization: true`) switches the active org too.
- If no active org: `/api/v1` endpoints return **403** `"No active organization. Select one to continue."`
- If the user was removed from the active org: **403** `"You are no longer a member of this organization."`

**The FE must:**

1. After **sign-up**, immediately sign in with the same credentials (dev) — or call `GET /api/auth/organization/list` and `set-active` the first org. In production, sign-up is followed by email verification + sign-in anyway.
2. After login, call `GET /api/auth/get-session` and read `session.activeOrganizationId`.
3. Show an org switcher when the user belongs to multiple orgs (`GET /api/auth/organization/list`).
4. Call `set-active` when the user picks a different org, then refetch links (drop any cached pages and cursors — they belong to the old org).
5. On either 403 above: refetch org list and prompt the user to pick/create an org.

### 2.4 Email verification (production only)

In **production** (`NODE_ENV=production`), email verification is **required** before sign-in works. In **development**, verification is skipped.

FE flows needed:

- Post sign-up: show "Check your email" message; offer "Resend verification" → `POST /api/auth/send-verification-email`
- Verification link lands on backend: `GET /api/auth/verify-email?token=...` — pass `callbackURL` (to `send-verification-email`) so the backend redirects to a FE page afterward; without it the API returns `{ "status": true, "user": null }` JSON
- Password reset: `POST /api/auth/request-password-reset` with `{ email, redirectTo }` — `redirectTo` should be a FE route like `https://app.example.com/reset-password`; the email link lands there as `?token=<token>`. The FE then calls `POST /api/auth/reset-password` with `{ token, newPassword }`. All the user's sessions are revoked on reset → send them to sign-in.

Invitation emails link to: `{BASE_URL}/accept-invitation/{invitationId}` — **build this page on the FE** (see §5.8).

---

## 3. Error Handling

There are **two** error shapes. Handle both.

**Better Auth routes (`/api/auth/*`):**

```json
{ "message": "Invalid email or password", "code": "INVALID_EMAIL_OR_PASSWORD" }
```

Common codes: `INVALID_EMAIL_OR_PASSWORD` (401), `EMAIL_NOT_VERIFIED` (403, prod), `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (422), `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG` (400), `ORGANIZATION_SLUG_ALREADY_TAKEN` (400), `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION` (400), `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION` (403), `INVITATION_NOT_FOUND` (400).

**App routes (`/api/v1/*`, redirect, health) and rate limits** use this envelope:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human-readable message"
  }
}
```

| HTTP | code                | When                                                                                              |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------- |
| 400  | `BAD_REQUEST`       | Validation failure, unknown body field, malformed JSON or cursor                                  |
| 401  | `UNAUTHORIZED`      | Missing/invalid session token                                                                     |
| 403  | `FORBIDDEN`         | No active org, removed from org, role lacks the permission, member deleting another member's link |
| 404  | `NOT_FOUND`         | Unknown route, unknown link id (also another org's link), unknown short code                      |
| 409  | `CONFLICT`          | Code taken or reserved                                                                            |
| 410  | `GONE`              | Expired short link (redirect route)                                                               |
| 413  | `PAYLOAD_TOO_LARGE` | Body > 16kb                                                                                       |
| 429  | `RATE_LIMITED`      | Too many requests                                                                                 |
| 500  | `INTERNAL`          | Server error                                                                                      |

FE helper: `const msg = body?.error?.message ?? body?.message ?? "Something went wrong"`.

**Rate limits (per IP):** `/api/auth/*` 20 req / 15 min · `/api/v1/*` 100 req / 15 min · redirect 600 req / min. Responses include standard `RateLimit-*` headers — use `RateLimit-Reset` (seconds) for a "try again in N s" message.

---

## 4. API Reference

### 4.1 Health (no auth)

| Method | Path      | Response                |
| ------ | --------- | ----------------------- |
| GET    | `/health` | `{ "status": "ok" }`    |
| GET    | `/ready`  | `{ "status": "ready" }` |

---

### 4.2 Auth — `/api/auth/*`

All auth routes are handled by Better Auth. JSON bodies unless noted.

#### Sign up

```
POST /api/auth/sign-up/email
Content-Type: application/json

{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "password123"
}
```

- Password: **8–72 characters**
- Response: `{ token, user }` in body; **session token in `set-auth-token` header**
- Side effect: personal organization created automatically — but this session has **no active org** (see §2.3); sign in next

#### Sign in

```
POST /api/auth/sign-in/email
{ "email": "jane@example.com", "password": "password123" }
```

- Response: user in body; token in **`set-auth-token` header**

#### Get session

```
GET /api/auth/get-session
Authorization: Bearer <token>
```

Response shape:

```json
{
  "session": {
    "id": "...",
    "userId": "...",
    "expiresAt": "2026-06-28T...",
    "activeOrganizationId": "org_abc123",
    "token": "..."
  },
  "user": {
    "id": "...",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "emailVerified": true,
    "image": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Returns `200` with body `null` if not authenticated (not a 401) — check for `null`.

#### Sign out

```
POST /api/auth/sign-out
Authorization: Bearer <token>
```

#### Revoke all sessions ("log out everywhere")

```
POST /api/auth/revoke-sessions
Authorization: Bearer <token>
```

#### Email verification

```
POST /api/auth/send-verification-email
{ "email": "jane@example.com", "callbackURL": "http://localhost:5173/verified" }
→ { "status": true }

GET /api/auth/verify-email?token=<token>[&callbackURL=...]
→ { "status": true, "user": null }   (or 302 to callbackURL)
→ 401 { "code": "INVALID_TOKEN" | "TOKEN_EXPIRED" }
```

#### Password reset

```
POST /api/auth/request-password-reset
{
  "email": "jane@example.com",
  "redirectTo": "http://localhost:5173/reset-password"
}
```

→ Always `{ "status": true, "message": "If this email exists in our system, check your email for the reset link" }` (doesn't reveal whether the account exists).

```
POST /api/auth/reset-password
{ "token": "<token from ?token=>", "newPassword": "newPassword123" }
→ { "status": true }
→ 400 { "code": "INVALID_TOKEN" | "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" }
```

#### JWT (optional — for microservices, not needed for basic FE)

```
GET /api/auth/token          → { "token": "<EdDSA JWT>" }
GET /api/auth/jwks           → JWKS public keys (no auth)
```

---

### 4.3 Organizations — `/api/auth/organization/*`

All require `Authorization: Bearer <token>`.

| Method | Path                     | Body / Query                                                                                     | Description                                                                                                |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/check-slug`            | `{ "slug": "acme" }`                                                                             | Returns `{ "status": true }` if available                                                                  |
| POST   | `/create`                | `{ "name": "Acme Inc", "slug": "acme", "logo?", "metadata?", "keepCurrentActiveOrganization?" }` | Creates org; caller becomes owner                                                                          |
| GET    | `/list`                  | —                                                                                                | Array of orgs user belongs to                                                                              |
| POST   | `/set-active`            | `{ "organizationId": "..." }` or `{ "organizationSlug": "..." }` or `{ "organizationId": null }` | Switch active tenant                                                                                       |
| GET    | `/get-full-organization` | `?organizationId=` or `?organizationSlug=` (optional)                                            | Org + members + invitations                                                                                |
| POST   | `/update`                | `{ "organizationId": "...", "data": { "name?", "slug?", "logo?", "metadata?" } }`                | Admin/owner only                                                                                           |
| POST   | `/invite-member`         | `{ "email": "...", "role": "member", "organizationId": "...", "resend?": true }`                 | Sends invitation email                                                                                     |
| GET    | `/list-invitations`      | `?organizationId=`                                                                               | All invitations (filter by `status`: `pending`/`accepted`/`rejected`/`canceled`)                           |
| GET    | `/get-invitation`        | `?id=<invitationId>`                                                                             | Single invitation + `organizationName`, `organizationSlug`, `inviterEmail` (for accept page). Invitee only |
| POST   | `/accept-invitation`     | `{ "invitationId": "..." }`                                                                      | Invited user must be signed in; email must match. Returns `{ invitation, member }`; makes the org active   |
| POST   | `/reject-invitation`     | `{ "invitationId": "..." }`                                                                      | Decline invite                                                                                             |
| POST   | `/cancel-invitation`     | `{ "invitationId": "..." }`                                                                      | Admin cancels pending invite                                                                               |
| GET    | `/list-members`          | `?organizationId=`                                                                               | `{ members: Member[], total }` (each member includes `user`)                                               |
| POST   | `/update-member-role`    | `{ "memberId": "...", "role": "admin", "organizationId": "..." }`                                | `memberId` = member row id, **not** user id. Roles: `owner`, `admin`, `member`                             |
| POST   | `/remove-member`         | `{ "memberIdOrEmail": "...", "organizationId": "..." }`                                          | Admin/owner                                                                                                |
| POST   | `/leave`                 | `{ "organizationId": "..." }`                                                                    | Current user leaves (owners must transfer first)                                                           |
| POST   | `/delete`                | `{ "organizationId": "..." }`                                                                    | Owner only; cascades all org URLs                                                                          |

**Permissions:**

| Action                                                          | owner | admin |  member  |
| --------------------------------------------------------------- | :---: | :---: | :------: |
| Update org, invite, cancel invite, change roles, remove members |   ✓   |   ✓   |    –     |
| Delete org                                                      |   ✓   |   –   |    –     |
| Create / list / view org links                                  |   ✓   |   ✓   |    ✓     |
| Delete org links                                                |  any  |  any  | own only |

A link's `createdBy` is the creator's user id: a `member` may delete a link only when `createdBy === session.user.id`. A role without a permission gets **403** `"Your role does not allow <resource>:<action>"` (e.g. `link:create`).

**Invitation expiry:** 48 hours.

**Invitation email link format:** `{BASE_URL}/accept-invitation/{invitationId}` — implement this route on the FE.

---

### 4.4 Links — `/api/v1/links/*`

All require auth **and** an active organization. Links are addressed by their
permanent `id` (`link_…`), never by `code` (the code is just the short URL's
path segment). Full reference: `docs/api/links.md`.

#### Create link

```
POST /api/v1/links
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://example.com/long/path",
  "code": "promo",                          // optional
  "title": "Launch post",                   // optional, ≤200
  "description": "Spring landing page",     // optional, ≤1000
  "expiresAt": "2030-01-01T00:00:00.000Z",  // optional, must be future
  "redirectType": 302,                      // optional, 301 | 302 (default 302)
  "utm": { "source": "newsletter", "medium": "email", "campaign": "launch" } // optional
}
```

Validation rules:

- `url`: valid http/https URL, max 2048 chars, no embedded credentials (`https://user:pass@…`), must not point at the shortener's own host
- `url` is checked against Google Safe Browsing (when configured) → 400 `"URL is flagged as unsafe"`
- `code`: optional, regex `^[A-Za-z0-9_-]{3,32}$`
- `title`/`description`: trimmed, can't be blank
- `utm`: any of `source`, `medium`, `campaign`, `term`, `content` (≤200 each). Merged into `url` as `utm_*` params; other query params are kept as sent. The final URL must stay ≤2048 chars → 400 otherwise
- `redirectType`: `302` (default) counts every visit; `301` is cached by browsers for up to an hour, so repeat visits in that hour aren't counted and edits reach those visitors late. Show this as a hint next to the toggle
- Reserved codes rejected: `api`, `health`, `ready`, `favicon.ico`, `robots.txt` → 409 `"Code is reserved"`
- Duplicate code → 409 `"Code already taken"`
- Unknown fields → 400 (`"Unrecognized key(s) in object: 'customAlias'"`)
- Validation errors come back as `"<field>: <reason>"`, e.g. `"url: must be an http(s) URL"` — map the prefix to the form field

**Response (201)**, with `Location: /api/v1/links/<id>`:

```json
{
  "id": "link_8fK2mQ9xLr0aTzW3bN7cYv1D",
  "code": "MZ0cYuF",
  "shortUrl": "http://localhost:3000/MZ0cYuF",
  "url": "https://example.com/long/path",
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
  "clicks": 0,
  "createdBy": "<user id>",
  "expiresAt": null,
  "createdAt": "2026-10-07T15:50:29.341Z"
}
```

Generated codes are 7 chars.

**`shareUrls`** — one tagged URL per platform. Clicks on these are attributed exactly to that platform in analytics. Use them for share buttons ("Copy for Instagram") and the `qr` one for QR codes. Use plain `shortUrl` when the destination is unknown.

#### List links (cursor pagination)

```
GET /api/v1/links?limit=20&sort=createdAt&order=desc
Authorization: Bearer <token>
```

- `limit`: 1–100, default 20
- `sort`: `createdAt` (default) or `clicks`
- `order`: `desc` (default) or `asc`
- `cursor`: the previous page's `nextCursor`; opaque — never build or parse it. A malformed cursor → 400.
- `q`: optional search, 1–100 chars, matched case-insensitively against code, title and URL (`%`/`_` are literal)
- `userId`: optional, only links created by that user ("Created by me" = `session.user.id`)
- Keep `q`, `userId`, `sort` and `order` unchanged while following a cursor; changing any of them starts a new list

**Response (200):**

```json
{
  "data": [
    /* Link[] */
  ],
  "nextCursor": "eyJrIjoi…" // null on the last page
}
```

There is no total count: use "Load more" / infinite scroll, not numbered pages.

#### Get link

```
GET /api/v1/links/:id
Authorization: Bearer <token>
```

Returns the Link. 404 if unknown or in another organization.

#### Update link

```
PATCH /api/v1/links/:id
Authorization: Bearer <token>
Content-Type: application/json

{ "title": "New title", "expiresAt": null, "utm": { "source": "x", "medium": null } }
```

- JSON merge: send **only changed fields**. Omitted = unchanged; `null` clears `title`, `description` or `expiresAt`
- Same validation as create. `url`, `code` and `redirectType` can't be `null`
- `utm` values set a param, `null` removes it; applied to the new `url` if both are sent, otherwise to the current one
- Changing `code` frees the old one **immediately** — anything already shared with the old short URL starts returning 404. Confirm with the user before saving a new code
- Response 200 with the updated Link (`updatedAt` changes). Empty body → 400. Member editing someone else's link → 403 `"Only organization admins can edit other members' links"`

#### Link stats

Use `GET /api/v1/analytics?linkId=<id>` (see [`docs/api/analytics.md`](./api/analytics.md)) for the link's time series and breakdowns (`groupBy=sources|countries|devices|…`). `clicks` on the Link is the all-time total.

- `clicks` **excludes bots** and link-preview crawlers (Slackbot, facebookexternalhit, curl, …). Testing with `curl` won't increase counts — use a real browser.

#### Delete link (soft delete)

```
DELETE /api/v1/links/:id
Authorization: Bearer <token>
```

**Response:** 204 No Content

- Plain `member` deleting someone else's link → 403 `"Only organization admins can delete other members' links"`. Use `createdBy` to hide the action for links the member didn't create.

---

### 4.5 Public redirect (no auth)

```
GET /:code
GET /:code/:channel      e.g. /aBc12X/ig
```

- **302** or **301** redirect to the link's `url` on success, per its `redirectType`
- Every response carries `X-Robots-Tag: noindex, nofollow`; short links never appear in search results
- **404** if unknown/deleted
- **410** if expired
- Unknown `channel` still redirects (attribution falls back to other signals)

Analytics captured automatically (IP, geo, UA, referer, UTM query params, channel tag). Query params on the short URL are **not** forwarded to the target.

The FE does **not** implement this route — it's server-side. Users share `shortUrl` directly.

---

## 5. Pages & User Flows

Build the following screens. Group under a dashboard layout after auth.

### 5.1 Public / Auth

| Route                    | Purpose                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `/sign-up`               | Name, email, password form → sign up → (dev) sign in with same credentials → store token → dashboard; (prod) "check your email" |
| `/sign-in`               | Email, password → sign in → store token → dashboard                                                                             |
| `/verify-email`          | Info page + resend button; or handle token from query string                                                                    |
| `/forgot-password`       | Email input → request reset                                                                                                     |
| `/reset-password`        | New password form (token from `?token=`) → `POST /api/auth/reset-password` → sign-in                                            |
| `/accept-invitation/:id` | Show org name from `GET .../get-invitation?id=`; if not signed in, prompt sign-in/sign-up first; then accept/reject             |

### 5.2 Dashboard (authenticated)

| Route           | Purpose                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` or `/links` | **Main view:** org's links, newest first, "Load more" pagination, sort by newest / oldest / most clicks                                                                           |
| `/links/new`    | Create link form (URL, optional custom code, optional expiry) — or inline modal on main view                                                                                      |
| `/links/:id`    | **Detail:** total clicks, expiry, copy button, per-platform share links, delete action. Route by `id` (`link_…`), not `code`. Analytics charts arrive with the analytics endpoint |

### 5.3 Organization

| Route                     | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `/settings/organization`  | Org name, slug, logo; member list; invite form   |
| `/settings/organizations` | List all orgs; create new org; switch active org |

**Org switcher:** persistent header dropdown showing current org name; switching calls `set-active` and refetches links.

### 5.4 Account

| Route               | Purpose                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/account` | Edit name + avatar URL (`POST /api/auth/update-user` → re-fetch session); email shown read-only; change password (`POST /api/auth/change-password` — if `revokeOtherSessions: true`, replace stored token with the new `set-auth-token`); sign out; revoke all sessions |

---

## 6. UI Components Checklist

### Links list page

- [ ] Table/cards: short URL (copyable), destination `url` (truncated), clicks, created date, expiry badge
- [ ] "Load more" / infinite scroll: request the next page with `cursor=nextCursor`; stop when `nextCursor` is `null`. No page numbers or totals
- [ ] Sort control: Newest (`sort=createdAt&order=desc`), Oldest (`order=asc`), Most clicks (`sort=clicks`). Changing sort resets the list and cursor
- [ ] Hide Edit and Delete for a `member` on links they didn't create (`createdBy !== session.user.id`)
- [ ] Search box → `q` (debounce ~300 ms; resets the list and cursor)
- [ ] "Created by me" toggle → `userId=session.user.id`
- [ ] Show `title` when set, else the short URL
- [ ] Empty state for new orgs
- [ ] Loading and error states
- [ ] Delete with confirmation

### Create link form

- [ ] URL input with validation feedback
- [ ] Optional custom code with live format hint (`3–32 chars, A-Z a-z 0-9 _ -`); 409 → "code taken" inline error
- [ ] Optional title and description
- [ ] Optional datetime picker for expiry (must be future)
- [ ] **UTM builder:** 5 optional inputs (source, medium, campaign, term, content) with a live preview of the final URL
- [ ] Redirect type toggle: 302 (default) / 301, with the 301 caveat as a hint
- [ ] Success: show generated short URL with copy button
- [ ] Map `"field: reason"` 400 messages to inline field errors

### Link detail

- [ ] Fetch with `GET /api/v1/links/:id`; 404 → "link not found" page (also when it belongs to another org)
- [ ] Summary cards: total clicks, created, expires (or "Never")
- [ ] **Share panel:** one copy button per platform from `shareUrls` (icon + name); QR code generated client-side from `shareUrls.qr` (a server QR endpoint arrives later)
- [ ] Copy short URL button
- [ ] Note in UI: bot/preview hits are excluded
- [ ] **Edit:** same form as create, prefilled; PATCH only the changed fields, `null` to clear title/description/expiry. Warn before changing `code` (old short URL stops working)
- [ ] Analytics charts from `GET /api/v1/analytics?linkId=<id>`: clicks over time, sources, countries, devices

### Org settings

- [ ] Member list with roles
- [ ] Invite by email + role selector
- [ ] Pending invitations list with cancel
- [ ] Leave org / delete org (with confirmations, owner-only for delete)

### Global

- [ ] Auth guard: redirect unauthenticated users to `/sign-in`
- [ ] 401 interceptor: clear token, redirect to sign-in
- [ ] 403 no-org / removed-from-org: refetch orgs, prompt to select/create org
- [ ] Toast/snackbar for API errors using `error.message`
- [ ] Rate limit (429) friendly message

---

## 7. TypeScript Types (copy into FE)

```ts
/** App error envelope (/api/v1, redirect, 429) */
interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/** Better Auth error (/api/auth/*) */
interface AuthError {
  code: string;
  message: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  activeOrganizationId: string | null;
  token: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata?: unknown;
  createdAt: string;
}

type Role = "owner" | "admin" | "member";

interface Member {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  createdAt: string;
  user?: Pick<User, "id" | "name" | "email" | "image">;
}

interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: string;
  inviterId: string;
  createdAt: string;
}

/** GET /api/auth/organization/get-invitation */
interface InvitationDetail extends Invitation {
  organizationName: string;
  organizationSlug: string;
  inviterEmail: string;
}

/** GET /api/auth/organization/get-full-organization */
interface FullOrganization extends Organization {
  members: Member[];
  invitations: Invitation[];
}

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

interface Link {
  /** Permanent id (`link_…`); use it in /api/v1/links/:id */
  id: string;
  code: string;
  shortUrl: string;
  url: string;
  title: string | null;
  description: string | null;
  redirectType: 301 | 302;
  /** Read back from `url`; the URL is the only place UTM values are stored */
  utm: Utm;
  shareUrls: Record<Platform, string>;
  clicks: number;
  /** User id of the member who created the link */
  createdBy: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Utm = Record<"source" | "medium" | "campaign" | "term" | "content", string | null>;

/** GET /api/v1/links */
interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** GET /api/v1/links query */
interface ListLinksQuery {
  limit?: number; // 1–100, default 20
  cursor?: string; // nextCursor from the previous page
  sort?: "createdAt" | "clicks"; // default createdAt
  order?: "asc" | "desc"; // default desc
  q?: string; // search code, title, URL
  userId?: string; // creator filter
}

/** POST /api/v1/links body (unknown keys → 400) */
interface CreateLinkBody {
  url: string;
  code?: string;
  title?: string;
  description?: string;
  expiresAt?: string; // ISO, future
  redirectType?: 301 | 302;
  utm?: Partial<Utm>; // null removes a param
}

/** PATCH /api/v1/links/:id — send only changed fields; null clears */
interface UpdateLinkBody {
  url?: string;
  code?: string;
  title?: string | null;
  description?: string | null;
  expiresAt?: string | null;
  redirectType?: 301 | 302;
  utm?: Partial<Utm>;
}
```

---

## 8. Suggested Tech Stack (agent's choice)

Not prescribed by the backend. Reasonable defaults:

| Layer         | Suggestion                                                   |
| ------------- | ------------------------------------------------------------ |
| Framework     | React (Vite) or Next.js App Router                           |
| Auth client   | `better-auth` React client + bearer, or custom fetch wrapper |
| Forms         | react-hook-form + zod (mirror backend validation rules)      |
| UI            | shadcn/ui + Tailwind                                         |
| Data fetching | TanStack Query                                               |
| Routing       | React Router or Next.js file routes                          |

---

## 9. Environment Variables (Frontend)

```env
# Required
VITE_API_URL=http://localhost:3000

# Optional — if FE handles invitation/reset links on a different domain
VITE_APP_URL=http://localhost:5173
```

Ensure backend `CORS_ORIGINS` includes `VITE_APP_URL`.

Backend env the FE team should know about:

| Variable              | Effect on FE                                                |
| --------------------- | ----------------------------------------------------------- |
| `BASE_URL`            | Prefix for `shortUrl` in API responses — display/copy as-is |
| `CORS_ORIGINS`        | Must allow FE origin                                        |
| `NODE_ENV=production` | Enables email verification gate on sign-in                  |

---

## 10. Testing the Integration

1. Start backend: `bun run dev` (port 3000)
2. Reference requests: open the `bruno/` collection in [Bruno](https://www.usebruno.com) (preferred, runs end-to-end) or import `url-shortener.postman_collection.json`
3. Manual smoke test order:
   - Sign up → then **sign in** → capture `set-auth-token` header
   - Get session → confirm `activeOrganizationId` is set
   - Create link → note `id`, copy `shortUrl`
   - List links → see item; with `limit=1`, follow `nextCursor` until `null`
   - Open `shortUrl` and a `shareUrls.instagram` link in a **browser** (curl counts as a bot) → redirects
   - Get link by `id` → `clicks` went up (recording is async; may take ~1 s)
   - Delete by `id` → 204; the short URL now 404s
   - Create org → set active → create a link in the new org; the old org's link `id` now 404s
4. Auth rate limit is 20 req / 15 min per IP — heavy manual testing will hit 429s; restart the backend (in-memory store) or flush `rl:auth:*` keys in Redis. `/api/v1/*` has its own 100 / 15 min limit (`rl:api:*`)

---

## 11. Out of Scope (backend handles these)

- Short link redirect (`GET /:code`, `GET /:code/:channel`) — do not reimplement in FE router (avoid catching `/:code` in SPA unless you proxy to API)
- Click tracking and source attribution — automatic on redirect
- Email sending — backend logs in dev, Resend in prod
- JWT/JWKS — only needed if FE talks to other services; session bearer token is sufficient for this API

---

## 12. Security Notes for FE

- Store session token in `sessionStorage` (cleared on tab close) or memory; avoid `localStorage` if XSS is a concern
- Never log or expose the bearer token
- Use HTTPS in production
- Validate URLs client-side before submit (http/https only)
- Treat `id` and `nextCursor` as opaque strings: never parse, build or edit them
- Role-gated UI: hide invite/remove/delete-org actions for non-admin members, and Delete on links a `member` didn't create (backend enforces too). Find the caller's role by matching `session.userId` against `members[].userId` from `get-full-organization`

---

## 13. Quick Reference — Request Flow

```
┌─────────────┐     sign-up/in      ┌──────────────┐
│   Frontend  │ ──────────────────► │ Better Auth  │
│             │ ◄── set-auth-token  │ /api/auth/*  │
└─────────────┘                     └──────────────┘
       │
       │  Bearer token + active org
       ▼
┌─────────────┐                     ┌──────────────┐
│  Dashboard  │ ─ /api/v1/links ──► │  Links API   │
│  /links     │ ◄── Link, Page ──── │  /api/v1/*   │
└─────────────┘                     └──────────────┘
                                           │
                                           ▼
                                    GET /:code[/:channel] (public)
                                    302 → link.url
```

---

_Generated from backend source: Express + Better Auth + Drizzle. Endpoint reference: `docs/api/`. Request collections: `bruno/`, `url-shortener.postman_collection.json`._
