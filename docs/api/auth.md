# Auth API

Authentication is handled by [Better Auth](https://www.better-auth.com), mounted at `/api/auth/*`.

## Conventions (all APIs)

| Item | Value |
| --- | --- |
| Base URL | `http://localhost:3000` (set by `BASE_URL` / `BETTER_AUTH_URL`) |
| Content type | `application/json` |
| Auth | `Authorization: Bearer <session-token>` (or the `better-auth.session_token` cookie) |
| Rate limit | `/api/auth/*`: `AUTH_RATE_LIMIT_MAX` (default 20) per `RATE_LIMIT_WINDOW_MS` (default 15 min) per IP |

**Getting a token:** sign in (or sign up). The session token is returned in the `set-auth-token` **response header**. Send that exact value as the bearer token on later requests.

**Origin header:** any `/api/auth/*` request that carries a session cookie must also send an `Origin` (or `Referer`) header matching a trusted origin, otherwise Better Auth returns `403 MISSING_OR_NULL_ORIGIN`. Bearer-only requests (no cookie) don't need it.

**Error formats**

Better Auth routes (`/api/auth/*`):

```json
{ "message": "Invalid email or password", "code": "INVALID_EMAIL_OR_PASSWORD" }
```

App routes (`/api/urls`, redirects, health):

```json
{ "error": { "code": "BAD_REQUEST", "message": "url: must be an http(s) URL" } }
```

Rate-limited (any route) — `429`:

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests" } }
```

---

## Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/sign-up/email` | – | Register with email + password |
| POST | `/api/auth/sign-in/email` | – | Sign in, returns session token |
| GET | `/api/auth/get-session` | ✓ | Current session + user |
| POST | `/api/auth/update-user` | ✓ | Update profile (name, image) |
| POST | `/api/auth/change-password` | ✓ | Change password (knows current one) |
| POST | `/api/auth/sign-out` | ✓ | End current session |
| POST | `/api/auth/revoke-sessions` | ✓ | End all sessions of the user |
| GET | `/api/auth/token` | ✓ | Get a signed EdDSA JWT |
| GET | `/api/auth/jwks` | – | Public keys to verify JWTs |
| POST | `/api/auth/send-verification-email` | – | (Re)send email verification link |
| GET | `/api/auth/verify-email` | – | Verify email using token from link |
| POST | `/api/auth/request-password-reset` | – | Email a password reset link |
| POST | `/api/auth/reset-password` | – | Set new password using reset token |
| GET | `/api/auth/ok` | – | Auth service liveness |
| GET | `/health` | – | Process liveness |
| GET | `/ready` | – | Readiness (DB reachable) |

---

### POST `/api/auth/sign-up/email`

Creates a user. A personal organization (`"<name>'s Organization"`) is created automatically and becomes the session's active organization.

Password: 8–72 characters. In `production`, email verification is required before sign-in.

**Request**

```json
{
  "name": "Test User",
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** `200` — header `set-auth-token: <session-token>`

```json
{
  "token": "u4Io7owKbmVatpDpDHEKcd03qzlU8z3P",
  "user": {
    "id": "1Fgu40sjczLzmiDXfXJdQjMMC8tqI8DE",
    "name": "Test User",
    "email": "user@example.com",
    "emailVerified": false,
    "image": null,
    "createdAt": "2026-10-07T15:50:13.776Z",
    "updatedAt": "2026-10-07T15:50:13.776Z"
  }
}
```

> The sign-up session is created **before** the personal org exists, so it has no active organization. Sign in once to get a session pinned to the org before calling `/api/urls`.

**Errors**

| Status | Code |
| --- | --- |
| 400 | `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `INVALID_EMAIL` |
| 422 | `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` |

---

### POST `/api/auth/sign-in/email`

**Request**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** `200` — header `set-auth-token: vcOoURsNmhOoPMMW05JdMwjto6zeHkZy.4caE/z+O8A7G...`

```json
{
  "redirect": false,
  "token": "vcOoURsNmhOoPMMW05JdMwjto6zeHkZy",
  "user": {
    "id": "1Fgu40sjczLzmiDXfXJdQjMMC8tqI8DE",
    "name": "Test User",
    "email": "user@example.com",
    "emailVerified": false,
    "image": null,
    "createdAt": "2026-10-07T15:50:13.776Z",
    "updatedAt": "2026-10-07T15:50:13.776Z"
  }
}
```

> Use the **`set-auth-token` header** value (signed, contains a `.`) as the bearer token, not the `token` field from the body.

**Errors**

| Status | Code |
| --- | --- |
| 401 | `INVALID_EMAIL_OR_PASSWORD` |
| 403 | `EMAIL_NOT_VERIFIED` (production only) |

```json
{ "message": "Invalid email or password", "code": "INVALID_EMAIL_OR_PASSWORD" }
```

---

### GET `/api/auth/get-session`

**Headers:** `Authorization: Bearer <token>`

**Response** `200`

```json
{
  "session": {
    "id": "b1mkqPbxq0a3dU3rwrHhIWdsWQl1Bi12",
    "token": "1lVIhk7l2qwTdJbNawYhe2n4QBypkn3o",
    "userId": "1Fgu40sjczLzmiDXfXJdQjMMC8tqI8DE",
    "activeOrganizationId": "1o3vwODcnKuRCu0RguqS6ouRmQHIQm0p",
    "expiresAt": "2026-10-14T15:50:19.905Z",
    "createdAt": "2026-10-07T15:50:19.905Z",
    "updatedAt": "2026-10-07T15:50:19.905Z",
    "ipAddress": "127.0.0.1",
    "userAgent": "curl/8.7.1"
  },
  "user": {
    "id": "1Fgu40sjczLzmiDXfXJdQjMMC8tqI8DE",
    "name": "Test User",
    "email": "user@example.com",
    "emailVerified": false,
    "image": null,
    "createdAt": "2026-10-07T15:50:13.776Z",
    "updatedAt": "2026-10-07T15:50:13.776Z"
  }
}
```

Invalid / expired / missing token → `200` with body `null`.

Sessions last 7 days and are refreshed every 24 h of use.

---

### POST `/api/auth/update-user`

Updates the signed-in user's profile. Send only the fields to change.

**Headers:** `Authorization: Bearer <token>`

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Display name |
| `image` | string \| null | Avatar URL (`null` to clear) |

`email` is **not** updatable here.

**Request**

```json
{
  "name": "Jane Doe",
  "image": "https://example.com/avatar.png"
}
```

**Response** `200`

```json
{ "status": true }
```

The body doesn't include the user — re-fetch `GET /api/auth/get-session` to get the updated profile:

```json
{
  "user": {
    "id": "iheknMevlhmXfUeSsEdsExG1kAppEstG",
    "name": "Jane Doe",
    "email": "user@example.com",
    "emailVerified": false,
    "image": "https://example.com/avatar.png",
    "createdAt": "2026-10-07T16:45:37.865Z",
    "updatedAt": "2026-10-07T16:45:38.033Z"
  }
}
```

**Errors**

| Status | Body |
| --- | --- |
| 400 | `{ "message": "Email can not be updated", "code": "EMAIL_CAN_NOT_BE_UPDATED" }` |
| 400 | `{ "message": "No fields to update" }` |
| 401 | `{ "message": "Unauthorized", "code": "UNAUTHORIZED" }` |

---

### POST `/api/auth/change-password`

**Headers:** `Authorization: Bearer <token>`

**Request**

```json
{
  "currentPassword": "password123",
  "newPassword": "password456",
  "revokeOtherSessions": true
}
```

`newPassword`: 8–72 chars. `revokeOtherSessions` optional (default `false`).

**Response** `200`

```json
{
  "token": "L70Vskv78QsAjKD9rHyBZvMmteaQ9z7Q",
  "user": {
    "id": "iheknMevlhmXfUeSsEdsExG1kAppEstG",
    "name": "Jane Doe",
    "email": "user@example.com",
    "emailVerified": false,
    "image": "https://example.com/avatar.png",
    "createdAt": "2026-10-07T16:45:37.865Z",
    "updatedAt": "2026-10-07T16:45:38.033Z"
  }
}
```

> With `revokeOtherSessions: true`, **every** session is revoked — including the current one — and a new session is issued. Its token comes back in the `set-auth-token` header (and `token` in the body). Replace the stored token or the next request gets 401. Without it, `token` is `null` and the current token keeps working.

**Errors:** `400 INVALID_PASSWORD` (wrong current password), `400 PASSWORD_TOO_SHORT`, `400 PASSWORD_TOO_LONG`.

---

### POST `/api/auth/sign-out`

**Headers:** `Authorization: Bearer <token>`

**Request:** `{}`

**Response** `200`

```json
{ "success": true }
```

---

### POST `/api/auth/revoke-sessions`

Revokes **every** session of the current user (all devices).

**Headers:** `Authorization: Bearer <token>`

**Request:** `{}`

**Response** `200`

```json
{ "status": true }
```

---

### GET `/api/auth/token`

Returns a short-lived (15 min) EdDSA-signed JWT for stateless verification by other services.

**Headers:** `Authorization: Bearer <session-token>`

**Response** `200`

```json
{
  "token": "eyJhbGciOiJFZERTQSIsImtpZCI6InB3UEludmRF...<snip>...ZhYfWUrZWBA"
}
```

Decoded payload:

```json
{
  "sub": "1Fgu40sjczLzmiDXfXJdQjMMC8tqI8DE",
  "id": "1Fgu40sjczLzmiDXfXJdQjMMC8tqI8DE",
  "name": "Test User",
  "email": "user@example.com",
  "emailVerified": false,
  "image": null,
  "iat": 1791388229,
  "exp": 1791389129,
  "iss": "http://localhost:3000",
  "aud": "http://localhost:3000"
}
```

---

### GET `/api/auth/jwks`

Public JSON Web Key Set for verifying tokens from `/api/auth/token`.

**Response** `200`

```json
{
  "keys": [
    {
      "alg": "EdDSA",
      "crv": "Ed25519",
      "kty": "OKP",
      "x": "s6aSU810EgECuj_tKxq8dmM_ov9pDMmw4EIGku1XFNQ",
      "kid": "pwPInvdEcepqf0swm5Gnxu8SnZrRS3qV"
    }
  ]
}
```

---

### POST `/api/auth/send-verification-email`

Sends a verification link to the address. Sent automatically on sign-up in production.

**Request**

```json
{
  "email": "user@example.com",
  "callbackURL": "http://localhost:3000/verified"
}
```

`callbackURL` is optional — where the link redirects after verifying.

**Response** `200`

```json
{ "status": true }
```

---

### GET `/api/auth/verify-email`

Target of the emailed link.

**Query**

| Param | Required | Description |
| --- | --- | --- |
| `token` | ✓ | Token from the email link |
| `callbackURL` | – | If set, responds with a redirect there instead of JSON |

```
GET /api/auth/verify-email?token=eyJhbGciOiJIUzI1NiJ9...
```

**Response** `200`

```json
{ "status": true, "user": null }
```

**Errors**

```json
{ "message": "Invalid token", "code": "INVALID_TOKEN" }
```

`401 INVALID_TOKEN`, `401 TOKEN_EXPIRED`.

---

### POST `/api/auth/request-password-reset`

Emails a reset link. Always returns success (doesn't reveal whether the email exists).

**Request**

```json
{
  "email": "user@example.com",
  "redirectTo": "http://localhost:3000/reset-password"
}
```

**Response** `200`

```json
{
  "status": true,
  "message": "If this email exists in our system, check your email for the reset link"
}
```

The link lands on `redirectTo?token=<reset-token>`.

---

### POST `/api/auth/reset-password`

Sets a new password. All existing sessions of the user are revoked.

**Request**

```json
{
  "token": "<reset-token>",
  "newPassword": "newPassword123"
}
```

**Response** `200`

```json
{ "status": true }
```

**Errors:** `400 INVALID_TOKEN`, `400 PASSWORD_TOO_SHORT`, `400 PASSWORD_TOO_LONG`.

---

### GET `/api/auth/ok`

**Response** `200`

```json
{ "ok": true }
```

---

### GET `/health`

Process is up. Not rate limited.

**Response** `200`

```json
{ "status": "ok" }
```

### GET `/ready`

Database reachable (`SELECT 1`).

**Response** `200`

```json
{ "status": "ready" }
```

Database down → `500 INTERNAL`.
