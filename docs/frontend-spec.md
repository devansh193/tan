# Frontend Specification — URL Shortener (tan)

> **Purpose:** This document is a complete handoff for an AI agent (or human developer) building the frontend for **tan**, a multi-tenant URL shortener. The backend already exists; build a SPA or SSR app that consumes these APIs.

---

## 1. Product Overview

**tan** is a URL shortener with:

- Email/password authentication (Better Auth)
- Multi-tenant **organizations** — every user gets a personal org on sign-up; teams can create orgs and invite members
- Org-scoped short links with optional custom aliases and expiry
- Click analytics (geo, device, browser, UTM, referer)
- Public redirect at `/{code}` (302 to original URL)

**Backend base URL (dev):** `http://localhost:3000`

**Frontend should run separately** (e.g. `http://localhost:5173`) and talk to the API via CORS. Set `CORS_ORIGINS` on the backend to include the FE origin in production.

---

## 2. Architecture Decisions for the Frontend

### 2.1 Auth model — Bearer token, not cookies

The backend uses Better Auth with the **bearer plugin**. There are **no cookie-based sessions** for API clients.

| Event | What to do |
|-------|------------|
| Sign up / Sign in | Read the **`set-auth-token` response header** (not the body). Store it securely (memory, `sessionStorage`, or httpOnly cookie via a BFF if you add one later). |
| Authenticated requests | Send `Authorization: Bearer <sessionToken>` on every protected call. |
| Sign out | `POST /api/auth/sign-out` with the bearer token, then clear stored token. |

Session lifetime: **7 days**, refreshed every 24h of activity.

### 2.2 Recommended client library

Use **`better-auth` client** with the bearer plugin, or plain `fetch` with a thin auth wrapper. The backend mounts all auth at `/api/auth/*`.

```ts
// Example env
VITE_API_URL=http://localhost:3000
```

### 2.3 Multitenancy — active organization

All URL management is scoped to the user's **active organization** on their session.

- On sign-up, the backend auto-creates a personal org (`"{name}'s Organization"`) and sets it as active.
- Users can belong to multiple orgs; they **switch** via `POST /api/auth/organization/set-active`.
- If no active org: URL endpoints return **403** `"No active organization. Select one to continue."`

**The FE must:**

1. After login, call `GET /api/auth/get-session` and read `session.activeOrganizationId`.
2. Show an org switcher when the user belongs to multiple orgs (`GET /api/auth/organization/list`).
3. Call `set-active` when the user picks a different org, then refresh URL data.

### 2.4 Email verification (production only)

In **production** (`NODE_ENV=production`), email verification is **required** before sign-in works. In **development**, verification is skipped.

FE flows needed:

- Post sign-up: show "Check your email" message; offer "Resend verification" → `POST /api/auth/send-verification-email`
- Verification link lands on backend: `GET /api/auth/verify-email?token=...` — FE can either link directly to the API or proxy through a `/verify-email` page that forwards the token
- Password reset: `POST /api/auth/request-password-reset` with `{ email, redirectTo }` — `redirectTo` should be a FE route like `https://app.example.com/reset-password` that collects the token from the email link

Invitation emails link to: `{BASE_URL}/accept-invitation/{invitationId}` — **build this page on the FE** (see §5.8).

---

## 3. Error Handling

All application errors use a consistent envelope:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human-readable message"
  }
}
```

| HTTP | code | When |
|------|------|------|
| 400 | `BAD_REQUEST` | Validation failure, malformed JSON |
| 401 | `UNAUTHORIZED` | Missing/invalid session token |
| 403 | `FORBIDDEN` | No active org, insufficient org role |
| 404 | `NOT_FOUND` | Unknown route or short link |
| 409 | `CONFLICT` | Alias taken or reserved |
| 410 | `GONE` | Expired short link (redirect route) |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 16kb |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL` | Server error |

Better Auth endpoints may return their own error shapes on 4xx — surface `message` to the user when present.

---

## 4. API Reference

### 4.1 Health (no auth)

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/ready` | `{ "status": "ready" }` |

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
- Response: user object in body; **session token in `set-auth-token` header**
- Side effect: personal organization created automatically

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

Returns `null` if not authenticated.

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
{ "email": "jane@example.com" }

GET /api/auth/verify-email?token=<token>
```

#### Password reset

```
POST /api/auth/request-password-reset
{
  "email": "jane@example.com",
  "redirectTo": "http://localhost:5173/reset-password"
}
```

Better Auth also exposes reset completion endpoints — consult Better Auth docs for the token submission route your version uses.

#### JWT (optional — for microservices, not needed for basic FE)

```
GET /api/auth/token          → { "token": "<EdDSA JWT>" }
GET /api/auth/jwks           → JWKS public keys (no auth)
```

---

### 4.3 Organizations — `/api/auth/organization/*`

All require `Authorization: Bearer <token>`.

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| POST | `/check-slug` | `{ "slug": "acme" }` | Returns `{ "status": true }` if available |
| POST | `/create` | `{ "name": "Acme Inc", "slug": "acme", "logo?", "metadata?", "keepCurrentActiveOrganization?" }` | Creates org; caller becomes owner |
| GET | `/list` | — | Array of orgs user belongs to |
| POST | `/set-active` | `{ "organizationId": "..." }` or `{ "organizationSlug": "..." }` or `{ "organizationId": null }` | Switch active tenant |
| GET | `/get-full-organization` | `?organizationId=` or `?organizationSlug=` (optional) | Org + members + invitations |
| POST | `/update` | `{ "organizationId": "...", "data": { "name?", "slug?", "logo?", "metadata?" } }` | Admin/owner only |
| POST | `/invite-member` | `{ "email": "...", "role": "member", "organizationId": "...", "resend?": true }` | Sends invitation email |
| GET | `/list-invitations` | `?organizationId=` | Pending invitations |
| GET | `/get-invitation` | `?id=<invitationId>` | Single invitation (for accept page) |
| POST | `/accept-invitation` | `{ "invitationId": "..." }` | Invited user must be signed in; email must match |
| POST | `/reject-invitation` | `{ "invitationId": "..." }` | Decline invite |
| POST | `/cancel-invitation` | `{ "invitationId": "..." }` | Admin cancels pending invite |
| GET | `/list-members` | `?organizationId=` | Org members |
| POST | `/update-member-role` | `{ "memberId": "...", "role": "admin", "organizationId": "..." }` | Roles: `owner`, `admin`, `member` |
| POST | `/remove-member` | `{ "memberIdOrEmail": "...", "organizationId": "..." }` | Admin/owner |
| POST | `/leave` | `{ "organizationId": "..." }` | Current user leaves (owners must transfer first) |
| POST | `/delete` | `{ "organizationId": "..." }` | Owner only; cascades all org URLs |

**Invitation expiry:** 48 hours.

**Invitation email link format:** `{BASE_URL}/accept-invitation/{invitationId}` — implement this route on the FE.

---

### 4.4 URLs — `/api/urls/*`

All require auth **and** an active organization.

#### Create short link

```
POST /api/urls
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://example.com/long/path",
  "customAlias": "promo",        // optional
  "expiresAt": "2030-01-01T00:00:00.000Z"  // optional, must be future
}
```

Validation rules:

- `url`: valid http/https URL, max 2048 chars
- `customAlias`: optional, regex `^[A-Za-z0-9_-]{3,32}$`
- Reserved aliases rejected: `api`, `health`, `ready`, `favicon.ico`, `robots.txt`
- Duplicate alias → 409 `CONFLICT`

**Response (201):**

```json
{
  "code": "aBc12X",
  "shortUrl": "http://localhost:3000/aBc12X",
  "originalUrl": "https://example.com/long/path",
  "clickCount": 0,
  "expiresAt": null,
  "createdAt": "2026-06-21T12:00:00.000Z"
}
```

If `customAlias` was set, `code` equals the alias.

#### List org links (paginated)

```
GET /api/urls?limit=20&offset=0
Authorization: Bearer <token>
```

- `limit`: 1–100, default 20
- `offset`: ≥ 0, default 0

**Response (200):**

```json
{
  "items": [ /* ShortUrlView[] */ ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

#### Link stats

```
GET /api/urls/:code/stats
Authorization: Bearer <token>
```

**Response (200):** ShortUrlView + recent clicks:

```json
{
  "code": "aBc12X",
  "shortUrl": "http://localhost:3000/aBc12X",
  "originalUrl": "https://example.com/...",
  "clickCount": 15,
  "expiresAt": null,
  "createdAt": "...",
  "recentClicks": [
    {
      "id": 1,
      "urlId": 5,
      "ip": "203.0.113.1",
      "country": "US",
      "state": "CA",
      "city": "San Francisco",
      "browser": "Chrome 120.0",
      "os": "Mac OS 14.0",
      "device": "desktop",
      "referer": "https://twitter.com/...",
      "utmSource": "twitter",
      "utmMedium": "social",
      "utmCampaign": "launch",
      "createdAt": "2026-06-21T14:30:00.000Z"
    }
  ]
}
```

Returns 404 if link not found or not owned by active org. Recent clicks capped at **20** (not configurable from API).

#### Delete link (soft delete)

```
DELETE /api/urls/:code
Authorization: Bearer <token>
```

**Response:** 204 No Content

---

### 4.5 Public redirect (no auth)

```
GET /:code
```

- **302** redirect to `originalUrl` on success
- **404** if unknown/deleted
- **410** if expired

Analytics captured automatically (IP, geo, UA, referer, UTM query params on the short URL).

The FE does **not** implement this route — it's server-side. Users share `shortUrl` directly.

---

## 5. Pages & User Flows

Build the following screens. Group under a dashboard layout after auth.

### 5.1 Public / Auth

| Route | Purpose |
|-------|---------|
| `/sign-up` | Name, email, password form → sign up → store token → redirect to dashboard |
| `/sign-in` | Email, password → sign in → store token → dashboard |
| `/verify-email` | Info page + resend button; or handle token from query string |
| `/forgot-password` | Email input → request reset |
| `/reset-password` | New password form (token from email query param) |
| `/accept-invitation/:id` | Show org name from `GET .../get-invitation?id=`; if not signed in, prompt sign-in/sign-up first; then accept/reject |

### 5.2 Dashboard (authenticated)

| Route | Purpose |
|-------|---------|
| `/` or `/links` | **Main view:** paginated table of org's short links |
| `/links/new` | Create link form (URL, optional alias, optional expiry) — or inline modal on main view |
| `/links/:code` | **Detail / analytics:** click count, expiry, copy button, recent clicks table, delete action |

### 5.3 Organization

| Route | Purpose |
|-------|---------|
| `/settings/organization` | Org name, slug, logo; member list; invite form |
| `/settings/organizations` | List all orgs; create new org; switch active org |

**Org switcher:** persistent header dropdown showing current org name; switching calls `set-active` and refetches links.

### 5.4 Account

| Route | Purpose |
|-------|---------|
| `/settings/account` | Display name/email; sign out; revoke all sessions |

---

## 6. UI Components Checklist

### Links list page

- [ ] Table/cards: short URL (copyable), original URL (truncated), clicks, created date, expiry badge
- [ ] Pagination (limit/offset)
- [ ] Empty state for new orgs
- [ ] Loading and error states
- [ ] Delete with confirmation

### Create link form

- [ ] URL input with validation feedback
- [ ] Optional custom alias with live format hint (`3–32 chars, A-Z a-z 0-9 _ -`)
- [ ] Optional datetime picker for expiry (must be future)
- [ ] Success: show generated short URL with copy button

### Link detail / stats

- [ ] Summary cards: total clicks, created, expires (or "Never")
- [ ] Recent clicks table: time, country/city, browser, OS, device, referer, UTM fields
- [ ] Copy short URL button

### Org settings

- [ ] Member list with roles
- [ ] Invite by email + role selector
- [ ] Pending invitations list with cancel
- [ ] Leave org / delete org (with confirmations, owner-only for delete)

### Global

- [ ] Auth guard: redirect unauthenticated users to `/sign-in`
- [ ] 401 interceptor: clear token, redirect to sign-in
- [ ] 403 no-org: prompt to select/create org
- [ ] Toast/snackbar for API errors using `error.message`
- [ ] Rate limit (429) friendly message

---

## 7. TypeScript Types (copy into FE)

```ts
/** API error envelope */
interface ApiError {
  error: {
    code: string;
    message: string;
  };
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
  createdAt: string;
}

interface Member {
  id: string;
  organizationId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
  user?: User;
}

interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  inviterId: string;
  createdAt: string;
}

interface ShortUrl {
  code: string;
  shortUrl: string;
  originalUrl: string;
  clickCount: number;
  expiresAt: string | null;
  createdAt: string;
}

interface Click {
  id: number;
  urlId: number;
  ip: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  referer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
}

interface PagedUrls {
  items: ShortUrl[];
  total: number;
  limit: number;
  offset: number;
}

interface UrlStats extends ShortUrl {
  recentClicks: Click[];
}
```

---

## 8. Suggested Tech Stack (agent's choice)

Not prescribed by the backend. Reasonable defaults:

| Layer | Suggestion |
|-------|------------|
| Framework | React (Vite) or Next.js App Router |
| Auth client | `better-auth` React client + bearer, or custom fetch wrapper |
| Forms | react-hook-form + zod (mirror backend validation rules) |
| UI | shadcn/ui + Tailwind |
| Data fetching | TanStack Query |
| Routing | React Router or Next.js file routes |

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

| Variable | Effect on FE |
|----------|--------------|
| `BASE_URL` | Prefix for `shortUrl` in API responses — display/copy as-is |
| `CORS_ORIGINS` | Must allow FE origin |
| `NODE_ENV=production` | Enables email verification gate on sign-in |

---

## 10. Testing the Integration

1. Start backend: `bun run dev` (port 3000)
2. Import `url-shortener.postman_collection.json` for reference requests
3. Manual smoke test order:
   - Sign up → capture `set-auth-token` header
   - Get session → confirm `activeOrganizationId`
   - Create URL → copy `shortUrl`
   - List URLs → see item
   - Open `shortUrl` in browser → redirects
   - Stats → see click recorded
   - Delete → 204
   - Create org → set active → create URL in new org

---

## 11. Out of Scope (backend handles these)

- Short link redirect (`GET /:code`) — do not reimplement in FE router (avoid catching `/:code` in SPA unless you proxy to API)
- Click tracking — automatic on redirect
- Email sending — backend logs in dev, Resend in prod
- JWT/JWKS — only needed if FE talks to other services; session bearer token is sufficient for this API

---

## 12. Security Notes for FE

- Store session token in `sessionStorage` (cleared on tab close) or memory; avoid `localStorage` if XSS is a concern
- Never log or expose the bearer token
- Use HTTPS in production
- Validate URLs client-side before submit (http/https only)
- Role-gated UI: hide invite/remove/delete-org actions for non-admin members (backend enforces too)

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
│  Dashboard  │ ── POST /api/urls ─►│  URL API     │
│  /links     │ ◄── ShortUrlView ──│  /api/urls/* │
└─────────────┘                     └──────────────┘
                                           │
                                           ▼
                                    GET /:code (public)
                                    302 → originalUrl
```

---

*Generated from backend source: Express + Better Auth + Drizzle. Postman collection: `url-shortener.postman_collection.json`.*
