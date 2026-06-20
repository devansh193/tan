# 🔗 URL Shortener

A production-minded URL shortener backend — clean architecture, secure token
auth, and reversible short codes powered by a counter + bijective function.

> 🤖 **Built with [Claude Opus 4.8](https://www.anthropic.com).** The entire
> backend — architecture, implementation, hardening, tests, and tooling — was
> designed and written in collaboration with Anthropic's Claude Opus 4.8 model.

<p>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" />
  <img alt="Express" src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Drizzle ORM" src="https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-30%20passing-success" />
  <img alt="Built with Claude Opus 4.8" src="https://img.shields.io/badge/Built%20with-Claude%20Opus%204.8-D97757" />
</p>

---

## ✨ Highlights

- **Reversible short codes** — each URL gets a monotonic `bigserial` counter id,
  mapped to a short code with [Sqids](https://sqids.org). Because Sqids is a
  bijection, codes are reversible and **collision-free** — no random generation,
  no uniqueness retries. Optional **custom aliases** override the generated code.
- **Better Auth** — email + password authentication via
  [Better Auth](https://better-auth.com), with the **bearer** plugin for
  header-token API access (no cookies) and the **jwt** plugin exposing verifiable
  **EdDSA JWTs** (`/api/auth/token`) plus a **JWKS** endpoint for stateless
  validation by other services.
- **Real features** — custom aliases, link expiry (410 Gone), soft-delete,
  per-click **analytics**, paginated listing, and "log out everywhere".
- **Hardened by default** — Helmet, CORS allowlist, rate limiting, Zod
  validation, a consistent error envelope, structured logging, and graceful
  shutdown.
- **Quality gates** — Vitest + Supertest suite, type-aware ESLint, Prettier, and
  GitHub Actions CI.

## 🧱 Architecture

A strict **repository → service → controller** layering, split into feature
modules with shared infrastructure.

```
src/
  config/env.ts            # validated, typed environment config
  common/                  # errors, logger, async wrapper, middleware
  db/                      # drizzle schema, client, migrate runner
  lib/auth.ts              # Better Auth instance (adapter, plugins, config)
  modules/
    auth/                  # requireAuth middleware (resolves Better Auth session)
    url/                   # repository, service, controller, routes, sqids
  app.ts                   # express app (middleware + routes)
  index.ts                 # server bootstrap + graceful shutdown
tests/                     # unit + DB-free integration tests
```

Each request flows **routes → controller → service → repository**: controllers
handle HTTP, services hold business logic, repositories own database access.

## 🛠️ Tech stack

| Concern       | Choice                                          |
| ------------- | ----------------------------------------------- |
| Runtime       | Bun + TypeScript                                |
| Web framework | Express                                         |
| Database      | PostgreSQL (via Docker)                         |
| ORM / queries | Drizzle ORM                                     |
| Short codes   | Sqids (bijective encoding)                      |
| Auth          | Better Auth (email/password, bearer + jwt)      |
| Validation    | Zod                                             |
| Logging       | Pino (+ pino-http request logging)              |
| Security      | Helmet, CORS allowlist, express-rate-limit      |
| Testing       | Vitest + Supertest                              |
| Tooling       | ESLint (type-aware) + Prettier + GitHub Actions |

## 🚀 Getting started

```bash
bun install
cp .env.example .env          # then set JWT_ACCESS_SECRET
docker compose up -d          # Postgres on host port 5433
bun run db:push               # create the schema
bun run dev                   # http://localhost:3000
```

Prefer to run everything (API + DB) in Docker?

```bash
docker compose --profile full up --build
```

### Scripts

| Script                | Purpose                        |
| --------------------- | ------------------------------ |
| `bun run dev`         | Run with reload (bun --watch)  |
| `bun run build`       | Compile to `dist/`             |
| `bun start`           | Run the compiled server        |
| `bun run test`        | Run the Vitest suite           |
| `bun run lint`        | ESLint (type-aware)            |
| `bun run format`      | Prettier write                 |
| `bun run typecheck`   | `tsc --noEmit`                 |
| `bun run db:push`     | Sync schema to the DB (dev)    |
| `bun run db:generate` | Generate SQL migrations        |
| `bun run db:migrate`  | Apply migrations               |

## 📡 API

All bodies are JSON. Authenticated endpoints require an
`Authorization: Bearer <accessToken>` header. Errors use a consistent envelope:

```json
{ "error": { "code": "BAD_REQUEST", "message": "email: Invalid email" } }
```

### Health

| Method | Path      | Description                             |
| ------ | --------- | --------------------------------------- |
| GET    | `/health` | Liveness (process up)                   |
| GET    | `/ready`  | Readiness (runs `SELECT 1` on Postgres) |

### Auth

| Method | Path                   | Body                  | Description                       |
| ------ | ---------------------- | --------------------- | --------------------------------- |
| POST   | `/api/auth/register`   | `{ email, password }` | Create account, return token pair |
| POST   | `/api/auth/login`      | `{ email, password }` | Verify credentials, return pair   |
| POST   | `/api/auth/refresh`    | `{ refreshToken }`    | Rotate tokens (reuse-detecting)   |
| POST   | `/api/auth/logout`     | `{ refreshToken }`    | Revoke one refresh token          |
| POST   | `/api/auth/logout-all` | — (auth)              | Revoke every session for the user |

Token responses: `{ "accessToken": "<jwt>", "refreshToken": "<opaque>" }`.
Passwords are 8–72 characters; emails are normalised (trimmed + lowercased).

### URLs

| Method | Path                    | Auth | Body / Query                        | Description                    |
| ------ | ----------------------- | ---- | ----------------------------------- | ------------------------------ |
| POST   | `/api/urls`             | yes  | `{ url, customAlias?, expiresAt? }` | Create a short link            |
| GET    | `/api/urls`             | yes  | `?limit=20&offset=0`                | List own links (paginated)     |
| GET    | `/api/urls/:code/stats` | yes  | —                                   | Click stats + recent clicks    |
| DELETE | `/api/urls/:code`       | yes  | —                                   | Soft-delete an own link        |
| GET    | `/:code`                | no   | —                                   | Redirect (302); 410 if expired |

`customAlias` is 3–32 chars (`A–Z a–z 0–9 _ -`); `expiresAt` is a future ISO
date. Reserved aliases (`api`, `health`, `ready`, …) are rejected.

```bash
# Register
curl -s -X POST localhost:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"password123"}'

# Shorten (use the accessToken from above)
curl -s -X POST localhost:3000/api/urls \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <accessToken>' \
  -d '{"url":"https://example.com/some/long/path"}'

# Visit the returned shortUrl -> 302 redirect
```

> 💡 A ready-to-import **Postman collection**
> (`url-shortener.postman_collection.json`) is included — it auto-captures tokens
> and the short code so requests chain together.

## 🔒 Security & operations notes

- Refresh tokens are stored only as SHA-256 hashes; the raw value is shown once.
- Rotation revokes the old token; replaying a revoked token revokes **all** of
  the user's sessions (theft response).
- Access JWTs carry and are verified against an issuer and audience.
- Rate limiting: a global cap plus a stricter cap on `/api/auth`.
- A background job periodically purges expired/revoked refresh tokens.
- Sqids over a sequential counter is **obfuscation, not encryption** — codes are
  enumerable. Set a shuffled `SQIDS_ALPHABET` per deployment; for truly secret
  links, add a random component.

## 🧪 Testing

```bash
bun run test
```

Unit tests cover the Sqids bijection, token signing/hashing, and the auth/URL
services (mocked repositories). Supertest covers routing, auth guards, and
validation — all without needing a database.

## 🤖 About this build

This project was built end-to-end with **Claude Opus 4.8** — from the initial
architecture and the counter-plus-Sqids design through security hardening
(refresh-token reuse detection, rate limiting, transactional writes), the test
suite, and the CI/lint tooling. The accompanying `IMPROVEMENTS.md` documents the
self-review pass that drove much of the hardening.
