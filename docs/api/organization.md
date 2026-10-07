# Organization API

Multitenancy via Better Auth's `organization` plugin, mounted at `/api/auth/organization/*`.

Conventions (base URL, bearer auth, `Origin` header, error format) are in [auth.md](./auth.md#conventions-all-apis). All endpoints below require `Authorization: Bearer <token>` and share the `/api/auth/*` rate limit.

**Model**

- Every user gets a personal organization on sign-up (`"<name>'s Organization"`, they are `owner`).
- Each session has one **active organization**; new sessions start on the user's first org. All `/api/v1` routes act on it.
- Roles: `owner`, `admin`, `member`.

| Action | owner | admin | member |
| --- | :-: | :-: | :-: |
| Update org | ✓ | ✓ | – |
| Delete org | ✓ | – | – |
| Invite / cancel invitation | ✓ | ✓ | – |
| Update member role / remove member | ✓ | ✓ | – |
| Delete any org link (`DELETE /api/v1/links/:id`) | ✓ | ✓ | own only |

Invitations expire after **48 hours**. The invite email links to `BASE_URL/accept-invitation/<invitationId>`.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/auth/organization/list` | Orgs the user belongs to |
| POST | `/api/auth/organization/check-slug` | Is a slug available |
| POST | `/api/auth/organization/create` | Create org (caller becomes owner) |
| POST | `/api/auth/organization/set-active` | Switch session's active org |
| GET | `/api/auth/organization/get-full-organization` | Active org with members + invitations |
| POST | `/api/auth/organization/update` | Rename / change slug, logo, metadata |
| POST | `/api/auth/organization/delete` | Delete org |
| GET | `/api/auth/organization/list-members` | Members of an org |
| POST | `/api/auth/organization/update-member-role` | Change a member's role |
| POST | `/api/auth/organization/remove-member` | Remove a member |
| POST | `/api/auth/organization/leave` | Leave an org |
| POST | `/api/auth/organization/invite-member` | Invite by email |
| GET | `/api/auth/organization/list-invitations` | Org's invitations |
| GET | `/api/auth/organization/get-invitation` | One invitation (as invitee) |
| POST | `/api/auth/organization/accept-invitation` | Accept (as invitee) |
| POST | `/api/auth/organization/reject-invitation` | Reject (as invitee) |
| POST | `/api/auth/organization/cancel-invitation` | Cancel (as inviter/admin) |

Where `organizationId` is optional, it defaults to the session's active organization.

---

### GET `/api/auth/organization/list`

**Response** `200`

```json
[
  {
    "id": "ecAkHoVvgN3odc1JIJ2nw6m8hsLyf3BE",
    "name": "Owner User's Organization",
    "slug": "owner-user-DtUPq1z8",
    "logo": null,
    "metadata": null,
    "createdAt": "2026-10-07T15:51:06.297Z"
  }
]
```

---

### POST `/api/auth/organization/check-slug`

**Request**

```json
{ "slug": "acme" }
```

**Response** `200` — available

```json
{ "status": true }
```

**Response** `400` — taken

```json
{ "message": "Organization slug already taken", "code": "ORGANIZATION_SLUG_ALREADY_TAKEN" }
```

---

### POST `/api/auth/organization/create`

**Request**

```json
{
  "name": "Acme Inc",
  "slug": "acme",
  "logo": "https://example.com/logo.png",
  "metadata": { "plan": "free" }
}
```

`logo`, `metadata` optional. Also accepts `keepCurrentActiveOrganization: true` to not switch the session to the new org.

**Response** `200`

```json
{
  "id": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "name": "Acme Inc",
  "slug": "acme",
  "logo": null,
  "createdAt": "2026-10-07T15:51:06.793Z",
  "members": [
    {
      "id": "XgpwRqBq2Dj96RmDbRgNZ0DVy0oH9sIs",
      "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
      "userId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
      "role": "owner",
      "createdAt": "2026-10-07T15:51:06.797Z"
    }
  ]
}
```

**Errors:** `400 ORGANIZATION_SLUG_ALREADY_TAKEN`.

---

### POST `/api/auth/organization/set-active`

**Request**

```json
{ "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0" }
```

Alternatively `{ "organizationSlug": "acme" }`. Send `{ "organizationId": null }` to clear.

**Response** `200`

```json
{
  "id": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "name": "Acme Inc",
  "slug": "acme",
  "logo": null,
  "metadata": null,
  "createdAt": "2026-10-07T15:51:06.793Z"
}
```

**Errors:** `403 USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`.

---

### GET `/api/auth/organization/get-full-organization`

Active org by default; or pass `?organizationId=` / `?organizationSlug=`.

**Response** `200`

```json
{
  "id": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "name": "Acme Corp",
  "slug": "acme",
  "logo": null,
  "metadata": null,
  "createdAt": "2026-10-07T15:51:06.793Z",
  "members": [
    {
      "id": "XgpwRqBq2Dj96RmDbRgNZ0DVy0oH9sIs",
      "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
      "userId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
      "role": "owner",
      "createdAt": "2026-10-07T15:51:06.797Z",
      "user": {
        "id": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
        "name": "Owner User",
        "email": "owner@example.com",
        "image": null
      }
    }
  ],
  "invitations": [
    {
      "id": "JFzlqZ472o0NZSsn5s5sXqR4Z4YNDACT",
      "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
      "email": "teammate@example.com",
      "role": "member",
      "status": "pending",
      "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
      "expiresAt": "2026-10-09T15:51:07.038Z",
      "createdAt": "2026-10-07T15:51:07.038Z"
    }
  ]
}
```

Returns `null` if no active org.

---

### POST `/api/auth/organization/update`

Owner/admin only.

**Request**

```json
{
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "data": {
    "name": "Acme Corp"
  }
}
```

`data` accepts any of `name`, `slug`, `logo`, `metadata`.

**Response** `200`

```json
{
  "id": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "name": "Acme Corp",
  "slug": "acme",
  "logo": null,
  "createdAt": "2026-10-07T15:51:06.793Z"
}
```

**Errors**

| Status | Code |
| --- | --- |
| 400 | `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` |
| 403 | `YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION` |

```json
{ "message": "User is not a member of the organization", "code": "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION" }
```

---

### POST `/api/auth/organization/delete`

Owner only. Irreversible.

**Request**

```json
{ "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0" }
```

**Response** `200` — the deleted org

```json
{
  "id": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "name": "Acme Corp",
  "slug": "acme",
  "logo": null,
  "metadata": null,
  "createdAt": "2026-10-07T15:51:06.793Z"
}
```

**Errors:** `403 YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION`.

---

### GET `/api/auth/organization/list-members`

**Query:** `organizationId` (optional), `limit`, `offset`, `sortBy`, `sortDirection` (`asc`/`desc`).

```
GET /api/auth/organization/list-members?organizationId=XE0k72R2uscmPRHewQ3QwJgXi23rDVk0
```

**Response** `200`

```json
{
  "members": [
    {
      "id": "XgpwRqBq2Dj96RmDbRgNZ0DVy0oH9sIs",
      "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
      "userId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
      "role": "owner",
      "createdAt": "2026-10-07T15:51:06.797Z",
      "user": {
        "id": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
        "name": "Owner User",
        "email": "owner@example.com",
        "image": null
      }
    },
    {
      "id": "7rD3KjSvxw9rp81hAB3L2RdkFfZEAgNn",
      "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
      "userId": "E81bARpIVGnGpopj4ZV00qHBBbgaaHfR",
      "role": "member",
      "createdAt": "2026-10-07T15:51:07.271Z",
      "user": {
        "id": "E81bARpIVGnGpopj4ZV00qHBBbgaaHfR",
        "name": "Teammate",
        "email": "teammate@example.com",
        "image": null
      }
    }
  ],
  "total": 2
}
```

---

### POST `/api/auth/organization/update-member-role`

Owner/admin only. `memberId` is the **member** id (from `list-members`), not the user id.

**Request**

```json
{
  "memberId": "7rD3KjSvxw9rp81hAB3L2RdkFfZEAgNn",
  "role": "admin",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0"
}
```

**Response** `200`

```json
{
  "id": "7rD3KjSvxw9rp81hAB3L2RdkFfZEAgNn",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "userId": "E81bARpIVGnGpopj4ZV00qHBBbgaaHfR",
  "role": "admin",
  "createdAt": "2026-10-07T15:51:07.271Z"
}
```

---

### POST `/api/auth/organization/remove-member`

Owner/admin only. The removed user loses access immediately (also enforced by `/api/v1`, which re-checks membership on every request).

**Request**

```json
{
  "memberIdOrEmail": "teammate@example.com",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0"
}
```

**Response** `200`

```json
{
  "member": {
    "id": "fXdNt6YKCyyvkGpo7JZqOQrzTLmqxaah",
    "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
    "userId": "SrGvTRBIqPt482M6xRchLroQR3DQtRtz",
    "role": "member",
    "createdAt": "2026-10-07T15:51:07.595Z",
    "user": {
      "id": "SrGvTRBIqPt482M6xRchLroQR3DQtRtz",
      "name": "Teammate",
      "email": "teammate@example.com",
      "image": null
    }
  }
}
```

---

### POST `/api/auth/organization/leave`

The last owner can't leave.

**Request**

```json
{ "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0" }
```

**Response** `200` — the removed membership

```json
{
  "id": "7rD3KjSvxw9rp81hAB3L2RdkFfZEAgNn",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "userId": "E81bARpIVGnGpopj4ZV00qHBBbgaaHfR",
  "role": "admin",
  "createdAt": "2026-10-07T15:51:07.271Z",
  "user": {
    "id": "E81bARpIVGnGpopj4ZV00qHBBbgaaHfR",
    "name": "Teammate",
    "email": "teammate@example.com",
    "image": null
  }
}
```

---

### POST `/api/auth/organization/invite-member`

Owner/admin only. Sends an invitation email.

**Request**

```json
{
  "email": "teammate@example.com",
  "role": "member",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0"
}
```

Optional `resend: true` re-sends to an already-invited email.

**Response** `200`

```json
{
  "id": "JFzlqZ472o0NZSsn5s5sXqR4Z4YNDACT",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "email": "teammate@example.com",
  "role": "member",
  "status": "pending",
  "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
  "expiresAt": "2026-10-09T15:51:07.038Z",
  "createdAt": "2026-10-07T15:51:07.038Z"
}
```

**Errors:** `400 USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`, `400 USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION`, `403 YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION`.

---

### GET `/api/auth/organization/list-invitations`

```
GET /api/auth/organization/list-invitations?organizationId=XE0k72R2uscmPRHewQ3QwJgXi23rDVk0
```

**Response** `200`

```json
[
  {
    "id": "JFzlqZ472o0NZSsn5s5sXqR4Z4YNDACT",
    "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
    "email": "teammate@example.com",
    "role": "member",
    "status": "pending",
    "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
    "expiresAt": "2026-10-09T15:51:07.038Z",
    "createdAt": "2026-10-07T15:51:07.038Z"
  },
  {
    "id": "G1V0y6T8fymRg0rVt8yo9hDDCu2cG5rg",
    "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
    "email": "ops@example.com",
    "role": "admin",
    "status": "pending",
    "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
    "expiresAt": "2026-10-09T15:51:07.160Z",
    "createdAt": "2026-10-07T15:51:07.160Z"
  }
]
```

`status`: `pending` | `accepted` | `rejected` | `canceled`.

---

### GET `/api/auth/organization/get-invitation`

Called by the **invitee** (signed in with the invited email).

```
GET /api/auth/organization/get-invitation?id=JFzlqZ472o0NZSsn5s5sXqR4Z4YNDACT
```

**Response** `200`

```json
{
  "id": "JFzlqZ472o0NZSsn5s5sXqR4Z4YNDACT",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "email": "teammate@example.com",
  "role": "member",
  "status": "pending",
  "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
  "expiresAt": "2026-10-09T15:51:07.038Z",
  "createdAt": "2026-10-07T15:51:07.038Z",
  "organizationName": "Acme Corp",
  "organizationSlug": "acme",
  "inviterEmail": "owner@example.com"
}
```

**Errors:** `400 INVITATION_NOT_FOUND`, `403 YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`.

---

### POST `/api/auth/organization/accept-invitation`

Invitee only. Adds the user as a member and makes the org their active org.

**Request**

```json
{ "invitationId": "JFzlqZ472o0NZSsn5s5sXqR4Z4YNDACT" }
```

**Response** `200`

```json
{
  "invitation": {
    "id": "JFzlqZ472o0NZSsn5s5sXqR4Z4YNDACT",
    "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
    "email": "teammate@example.com",
    "role": "member",
    "status": "accepted",
    "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
    "expiresAt": "2026-10-09T15:51:07.038Z",
    "createdAt": "2026-10-07T15:51:07.038Z"
  },
  "member": {
    "id": "7rD3KjSvxw9rp81hAB3L2RdkFfZEAgNn",
    "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
    "userId": "E81bARpIVGnGpopj4ZV00qHBBbgaaHfR",
    "role": "member",
    "createdAt": "2026-10-07T15:51:07.271Z"
  }
}
```

**Errors:** `400 INVITATION_NOT_FOUND` (also when expired or no longer pending), `403 YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`.

---

### POST `/api/auth/organization/reject-invitation`

Invitee only.

**Request**

```json
{ "invitationId": "B4Rs8kGp2V6h0XXKLhCyiCWuvpk2h2tb" }
```

**Response** `200`

```json
{
  "invitation": {
    "id": "B4Rs8kGp2V6h0XXKLhCyiCWuvpk2h2tb",
    "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
    "email": "other@example.com",
    "role": "member",
    "status": "rejected",
    "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
    "expiresAt": "2026-10-09T15:51:07.090Z",
    "createdAt": "2026-10-07T15:51:07.090Z"
  },
  "member": null
}
```

---

### POST `/api/auth/organization/cancel-invitation`

Owner/admin only.

**Request**

```json
{ "invitationId": "G1V0y6T8fymRg0rVt8yo9hDDCu2cG5rg" }
```

**Response** `200`

```json
{
  "id": "G1V0y6T8fymRg0rVt8yo9hDDCu2cG5rg",
  "organizationId": "XE0k72R2uscmPRHewQ3QwJgXi23rDVk0",
  "email": "ops@example.com",
  "role": "admin",
  "status": "canceled",
  "inviterId": "XYh2EOSgngbSugPNQ7uIiKJtWz30Otmp",
  "expiresAt": "2026-10-09T15:51:07.160Z",
  "createdAt": "2026-10-07T15:51:07.160Z"
}
```
