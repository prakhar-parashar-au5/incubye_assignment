# Builder response 06: Express authentication API

**Task:** `builder_docs/parent_instructions/06-authentication-api.md`
**Status:** Complete and verified. Not committed. Waiting for review.
**Scope kept:** no Next.js code, no browser cookies, no employee, HR-management, or salary endpoints, no upload, no AI or MCP.

## Task completed

- An Express 5 application factory with injected dependencies.
- The endpoints `GET /health`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`, and `GET /api/v1/openapi.json`.
- One public error shape, Zod validation, and Bearer authentication through the existing `authenticate()`.
- A failed-login rate limit.
- An OpenAPI 3.1 contract generated from the Zod schemas, plus a committed copy with a drift test.
- A separate server process with Zod-validated configuration and graceful shutdown.

Before starting I confirmed Task 05 is `ACCEPTED AND COMMITTED` and that `npm run check` passes (202 tests).

## Sources checked

| Topic | Source | What it decided |
|---|---|---|
| Express proxy | [expressjs.com: Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html) | `trust proxy` with a hop count is safe only if every path to the app has the same number of hops; with `true`, the last proxy must overwrite `X-Forwarded-*` |
| Railway headers | [docs.railway.com: Public networking specs & limits](https://docs.railway.com/networking/public-networking/specs-and-limits) | Request headers: "`X-Real-IP` for identifying client's remote IP" |
| Railway proxy behaviour | [Railway staff answer on Express and express-rate-limit](https://station.railway.com/questions/express-rate-limiting-security-trusted-ad01e74d) | The edge overwrites `X-Forwarded-For` and `X-Real-IP` on every request, with client copies replaced. Rate limiting should key on `X-Real-IP`, not `trust proxy`, because the forwarding chain has no fixed length and proxy addresses are not a stable range. Private networking (`*.railway.internal`) bypasses the edge |
| Zod → JSON Schema | [zod.dev/json-schema](https://zod.dev/json-schema) | `z.toJSONSchema` (default target JSON Schema 2020-12, the dialect OpenAPI 3.1 uses), registries for multiple schemas, the `uri` option for `$ref`s |
| express-rate-limit 8.7.4 | its shipped type declarations and `dist/index.mjs` | `Store` interface, `skipSuccessfulRequests`, `ipKeyGenerator`, `validate` options, and the decrement rule (see "Problems found") |
| Versions and licences | `npm view` | express 5.3.0, zod 4.6.7, express-rate-limit 8.7.4, supertest 7.3.2: all MIT and recently updated |

**OpenAPI integration choice.** I considered `@asteasolutions/zod-to-openapi` 9.1.0 and `zod-openapi` 6.0.2. Zod 4's own `z.toJSONSchema` produces exactly the component schemas OpenAPI 3.1 needs, so I added no extra dependency. The path list is written by hand in `openapi.ts`; a test checks that every documented operation is routed.

## Files changed (in `express-backend/`)

| File | Change |
|---|---|
| `src/http/contract.ts` | New. Zod schemas (`LoginRequest` strict, `LoginResponse`, `CurrentUserResponse`, `HealthResponse`, `ErrorResponse`), `PUBLIC_ERROR_CODES`, public messages, `PATHS`, and the OpenAPI component registry. |
| `src/http/openapi.ts` | New. `buildOpenApiDocument()`. |
| `src/http/app.ts` | New. `createApp({ auth, logger, clientIpSource, clock? })`. |
| `src/http/auth-routes.ts` | New. Bearer parsing, `requireAuth`, login, `/me`, logout. |
| `src/http/rate-limit.ts` | New. Failed-login limiter, `clientKey`, `ClockedMemoryStore`. |
| `src/http/errors.ts` | New. `ApiError`, `sendError`, 404 handler, error handler. |
| `src/http/request-log.ts` | New. Safe request logger and stdout JSON logger. |
| `src/http/config.ts` | New. `readServerConfig(env)` with Zod. |
| `src/server.ts` | New. Process entry point and graceful shutdown. |
| `scripts/generate-openapi.ts`, `openapi/openapi.json` | New. Generator and the committed contract. |
| `src/paths.ts` | Adds `OPENAPI_FILE`. |
| `src/access/sessions.ts` | `Principal` gains `sessionExpiresAt` (the database session expiry), which `/me` needs. This is additive; see "Changes to earlier code". |
| `test/db/access-control.test.ts` | One exact-shape assertion now also expects `sessionExpiresAt` (the expectation is stricter, not weaker). |
| `test/http-app.test.ts` | New. 32 tests. |
| `test/http-rate-limit.test.ts` | New. 9 tests. |
| `test/http-openapi.test.ts` | New. 9 tests. |
| `test/http-server-process.test.ts` | New. 4 tests. |
| `test/db/auth-api.test.ts` | New. 14 real-MySQL tests. |
| `test/support/http.ts` | New. In-memory `AuthService` stand-in and test-app builder. |
| `package.json`, `package-lock.json` | Runtime: `express@5.3.0`, `zod@4.6.7`, `express-rate-limit@8.7.4`. Dev: `@types/express@5.0.6`, `supertest@7.3.2`, `@types/supertest@7.2.1`. New scripts: `start` (`node dist/src/server.js`), `openapi:generate`. |
| `README.md` | HTTP API section and layout rows. |

No SQL, migration, workbook, seed, password, token-claim, access-rule, or audit code changed.

## API contract choices

- **Login.**
  - Request: `{ email, password }`, `z.strictObject`, so unknown fields are rejected. `email` must be a valid email of at most 254 characters; `password` is 1–1024 characters.
  - Response: `{ token, expiresAt (ISO), user: { id, displayName, email, role } }`.
  - The user summary comes from calling the existing `authenticate()` on the new token, the same lookup `/me` uses. `signIn()` is unchanged.
- **`/me`.** `{ user: { id, displayName, email, role, status }, scope: { countries, departments }, session: { expiresAt } }`, all from the per-request database lookup.
- **Logout.** `204` with no body.
  - It needs only a validly signed token and calls the existing `signOut()`, so it succeeds again after the session is revoked.
  - `signOut()` matches on both `sid` and `sub`, so it cannot revoke another user's session.
  - A missing or invalid token returns `401 UNAUTHENTICATED`.
- **Response construction.** Every response goes through its Zod schema's `.parse()`, so an extra field such as `sessionId` cannot be added by mistake.
- **No caching.** `Cache-Control: no-store` is set on all `/auth` responses.
- **Public errors.** Always `{ error: { code, message } }`:

  | Case | Status | Code | Message |
  |---|---:|---|---|
  | Bad body, malformed JSON, or non-JSON body | 400 | `VALIDATION_ERROR` | "Request is invalid." |
  | Body above 10 kb | 413 | `VALIDATION_ERROR` | "Request body is too large." |
  | Wrong credentials | 401 | `INVALID_CREDENTIALS` | "Email or password is incorrect." |
  | Authentication failure | 401 | `UNAUTHENTICATED` | "Authentication is required." (with `WWW-Authenticate: Bearer`) |
  | Rate limit | 429 | `RATE_LIMITED` | |
  | Unknown route or method | 404 | `NOT_FOUND` | |
  | Anything else | 500 | `INTERNAL_ERROR` | |

  Zod issue details are not returned: one public shape, and no submitted values echoed.
- **Bearer parsing.** Exactly `Bearer <one token>`. A missing header, another scheme, an empty token, or extra parts all return `UNAUTHENTICATED`.
- **OpenAPI.**
  - 3.1.0, with components generated by `z.toJSONSchema` from the contract registry (`$schema`/`$id` removed).
  - Security scheme: `bearerAuth` (`http`, `bearer`, `JWT`), applied to `/me` and `/logout` only.
  - `openapi/openapi.json` is written by `npm run openapi:generate`, and a test fails if it differs from the generated document.
- **Other settings.** `X-Powered-By` disabled. No CORS middleware: a preflight gets no `Access-Control-*` headers. No cookies are set.

## Rate-limit and proxy decisions

- **Rule.** `express-rate-limit` with `limit: 5`, `windowMs: 15 min`, and `skipSuccessfulRequests: true`.
  - Each attempt is counted, and attempts that end below status 400 are removed again, so only failures use the allowance.
  - Validation errors (400) count as failed attempts.
  - Once 5 failures exist, the 6th request in the window gets `429 RATE_LIMITED`, even with the correct password.
  - The limiter applies to `POST /api/v1/auth/login` only.
- **Client IP source** (`CLIENT_IP_SOURCE`, Zod-validated, default `socket`):
  - `socket`: `req.socket.remoteAddress`. `X-Forwarded-For` and `X-Real-IP` are ignored.
  - `railway-x-real-ip`: the `X-Real-IP` header, per Railway's documentation and staff answer above. `X-Forwarded-For` is never used.
  - A missing or non-IP value (checked with `net.isIP`) maps to one shared `unknown-client` bucket, so a malformed header cannot buy a fresh allowance.
  - IPv6 addresses are grouped by /56 through the library's `ipKeyGenerator`.
- **`trust proxy` stays `false`.** Railway documents no fixed hop count, so `req.ip` is never derived from forwarded headers. The library's trust-proxy and forwarded-header checks are turned off, because our key generator does not read `req.ip`.
- **Not verified on Railway.** No Railway deployment exists in this task. The `railway-x-real-ip` mode follows the documentation; it should be checked once on the deployed service (open decision 1).
- **Store.** `ClockedMemoryStore`, a fixed-window in-memory store with an injected clock (single process, `localKeys`).

## Logging

- **Request entries:** `{ event: 'request', requestId, method, path, status, durationMs }`. `path` is `req.path`, so the query string is dropped. The request ID is server-generated (client IDs are not trusted) and returned in the `X-Request-Id` header.
- **Unexpected errors:** `{ event: 'request_error', requestId, method, errorName, errorCode }`. The error message is never logged, because mysql2 messages can contain SQL values.
- **Never logged:** bodies, headers, tokens, cookies, emails, or configuration.

## Server process

- **Configuration.** `src/server.ts` reads `DATABASE_URL` (must be a `mysql:` URL), `JWT_SIGNING_KEY` (at least 32 bytes), `PORT` (default 3000, `0` allowed), and `CLIENT_IP_SOURCE` through Zod.
  - On failure it prints `Error: invalid server configuration: <variable names> (missing or invalid)` and exits 1. Values are never printed.
- **Startup.** It creates the pool, token service, auth service, and app, then logs `server_listening`.
- **Shutdown.** On `SIGTERM`/`SIGINT`: `server.close()` plus `closeIdleConnections()`, then `pool.end()`. It logs `server_stopped` and `database_pool_closed` and exits 0, with a forced exit after 10 s.

## Tests and the defects they detect

**`test/http-app.test.ts` (32; stand-in auth service, no database)**

| Tests | Detects |
|---|---|
| Construction opens no TCP listener; no `X-Powered-By`; JSON 404 for unknown path or wrong method; 413 above the body limit; no CORS headers on a preflight | Hidden listener, fingerprinting, HTML error pages, unbounded bodies, CORS left on |
| `/health` returns exactly `{status:'ok'}` with no version headers | Configuration leakage |
| Valid body accepted; 8 invalid bodies (missing email or password, non-string values, invalid email, empty password, unknown field, array body), malformed JSON, and non-JSON body → `400 VALIDATION_ERROR`; submitted values not echoed | Bad input reaching `signIn`, parser errors leaking, value echo |
| Login response shape and `Cache-Control: no-store`; wrong credentials → generic 401; no `Set-Cookie` | Contract drift, cached tokens, Express owning the cookie |
| Missing header, wrong scheme, empty token, or extra parts → 401 with `WWW-Authenticate`; all five internal reasons → one identical body without the reason text; `/me` shape with no session ID | Unauthenticated access, reason leakage |
| Logout 204 with no body; 204 for an already revoked session; 401 for a missing or invalid token | Token echo, non-idempotent logout |
| Log entries have exactly the six safe keys; no password, token, wrong password, cookie, query value, `Bearer`, or email; unexpected error → 500 `INTERNAL_ERROR` with only `errorName`/`errorCode` logged (the SQL-like message is not logged) | Secrets in logs, internals in responses |

**`test/http-rate-limit.test.ts` (9)**

| Tests | Detects |
|---|---|
| 5 failures allowed, 6th → 429; correct password blocked after the limit; separate IPs have separate limits; successes do not count (4 fails, 3 successes, 5th fail 401, 6th 429); window still closed 1 s before 15 min and open after it (injected clock, no waiting); `/health` not limited | Wrong limit, a global counter, successes counted, a window that never resets |
| Socket mode: rotating spoofed `X-Real-IP`/`X-Forwarded-For` share one limit; Railway mode: `X-Forwarded-For` ignored; missing, invalid, or list-valued `X-Real-IP` share one bucket | Trusting forwarded headers outside the approved mode; header tricks that reset the limit |

**`test/http-openapi.test.ts` (9)**

| Tests | Detects |
|---|---|
| Exactly the five operations, OpenAPI 3.1.0; login request requires email and password with `additionalProperties: false`; login and `/me` response fields; Bearer JWT scheme on `/me` and `/logout` only; error code enum equals the six approved codes; committed file equals generated; served document equals generated; every documented operation is routed | Contract gaps, open request objects, a drifting committed contract, documented routes that do not exist |

**`test/http-server-process.test.ts` (4; no MySQL needed, because `/health` never touches the lazy pool)**

| Tests | Detects |
|---|---|
| Config validation: defaults, valid overrides, and six invalid environments; error names the variables, not their values | Startup on bad configuration, secrets in errors |
| Missing config → exit 1 with a short message, no stack trace, no secret | Noisy or leaky startup failure |
| Server starts on port 0, answers `/health`, and on `SIGTERM` logs `server_stopped` and `database_pool_closed` and exits 0; no secrets in output | Hanging shutdown, unreleased pool |

**`test/db/auth-api.test.ts` (14; real MySQL, real `createAuthService`, shared synthetic password for both users)**

| Tests | Detects |
|---|---|
| Meera: token, `expiresAt` exactly +2 h, Admin summary, `sub` matches; Rohan: Scoped summary; unknown email, wrong password, inactive user → byte-identical 401; login response has no hash, status, or scopes | Wrong expiry or role, account enumeration |
| `/me`: Admin has empty scopes; Rohan has `IN` / `Support, Tech`; a scope change appears with the same JWT; deactivation blocks the next request; no token, session ID, hash, or audit data; forged, orphan, revoked, and expired tokens → one identical body without reason text | Cached authority, reason leakage |
| Logout: the database row's `revoked_at` is set to the clock time and `/me` then fails; repeated logout 204; a crafted token naming Meera's session under Rohan's ID returns 204 but Meera's session stays valid | Non-revoking logout, cross-user revocation |
| Logs during real sign-in contain no password, token, Argon2 hash, database URL, or database password, and record exactly the four requests | Secrets in logs |

## Red failures actually observed

- **Before implementation.** With the HTTP modules stubbed as empty modules, `npm test` reported 4 new test files failing at import (`does not provide an export named 'createApp'`) and the 202 earlier tests passing. These are file-level import failures, a weak red, not individual assertion failures.
- **After the first implementation.**
  - `http-app` passed 32/32, `http-openapi` 9/9, and `http-server-process` 4/4 on their first run.
  - `http-rate-limit` failed 1 test: "a successful login does not consume the failed-attempt allowance". This was a real defect, described below.
- **Mutation checks** (temporary code changes, then restored; marker search found 0):

| Mutation | Tests that failed |
|---|---|
| `skipSuccessfulRequests: false` | rate-limit "successful login does not consume…" |
| Socket mode keyed on `X-Forwarded-For` | rate-limit "spoofed X-Real-IP and X-Forwarded-For values share one limit" |
| Internal reason appended to the 401 message | http-app "every internal authentication failure returns the identical public body", plus 2 real-MySQL tests in `auth-api` |

## Problems found and fixed during the work

- **Rate-limit clock.** express-rate-limit decrements a successful request only if `Date.now()` is before the store's reset time (`dist/index.mjs`, `decrementKey`). My first test clock was fixed at 2026-11-14 10:00, while the real time was later. The library therefore saw every window as expired and never removed successes, so the 2nd success got 429. A trace of the `RateLimit` headers showed `r=0` after the first success.
  - **Fix:** the injected clock now follows real time plus an offset (`advance(ms)`), and `ClockedMemoryStore` documents that requirement.
  - **Consequence:** the real-MySQL API tests keep a fixed clock for sessions but give the rate limiter the real clock.
- **`/me` needs the database session expiry,** but `Principal` did not carry it. See the next section.

## Changes to earlier code

`Principal` gains `sessionExpiresAt: Date`, read from the same `hr_sessions.expires_at` row that `authenticate()` already loads.
- No query, check, or failure path changed.
- One Task 04 test compares the principal exactly. Its expected object now also includes `sessionExpiresAt: 2026-11-14T12:00:00.000Z`, which strengthens the assertion.
- I chose this over decoding `exp` from the JWT, because the design says `/me` reports the current database session.

## Commands and results

Run from `express-backend/`, with `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test'` for database commands:

| Command | Result |
|---|---|
| `npm run check` (before starting) | 202 pass |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | 256 tests, 256 pass (202 earlier + 54 new: http-app 32, rate-limit 9, openapi 9, server-process 4) |
| `npm run test:db` | 137 tests, 137 pass (123 earlier + 14 `auth-api`) |
| `npm audit --omit=dev` | only the existing ExcelJS `uuid` moderate advisory; nothing new |

**Compiled server smoke test.** After reset → compiled migrate → seed → demo users, with a temporary directory as the working directory: `JWT_SIGNING_KEY=… PORT=3999 node dist/src/server.js`.
- `GET /health` → `200 {"status":"ok"}`.
- Rohan login → 200, token (185 characters, redacted in output), user summary SCOPED.
- `/me` → `IN`, `Support, Tech`, the same `expiresAt` as login.
- Logout → `204`.
- `/me` after logout → `401 {"error":{"code":"UNAUTHENTICATED",…}}`.
- `/api/v1/openapi.json` → the five paths.
- `SIGTERM` → exit 0. The log shows `server_stopping`, `server_stopped`, and `database_pool_closed`; stderr was empty.
- **Secret scan of both output streams:** 0 matches for the password, signing key, database password, or token.

## Known limitations

- **Single-process limiter.** The in-memory store keeps counts per process: they reset on restart and are not shared across replicas. One Railway replica is assumed; multiple replicas would need a shared store.
- **Railway mode is unverified on a deployment.** `railway-x-real-ip` is safe only if the service is reached solely through Railway's public edge. Railway's private network can send its own `X-Real-IP`.
- **Shared office IPs.** Five failures from users behind one NAT lock out that whole IP for 15 minutes. This is a property of the approved IP-based rule.
- **No validation detail.** `VALIDATION_ERROR` does not say which field failed. The frontend must validate before submitting if it wants field messages.
- **Login cost.** Login performs `signIn` and then one `authenticate()` (about 3 extra small queries) to build the summary.
- **Hand-written paths.** The OpenAPI path list is written by hand, guarded by the "every documented operation is routed" and "exactly five endpoints" tests.
- **Untested signals.** Graceful shutdown was tested with `SIGTERM`. `SIGINT` uses the same handler but was not exercised.

## Open decisions

1. **Railway check.** After deployment, should the planner verify `CLIENT_IP_SOURCE=railway-x-real-ip` by sending a forged `X-Real-IP` through the public domain and confirming it is replaced?
2. **Validation counts as a failure.** Malformed login requests (400) count toward the failed-login limit. Keep this, or count only `INVALID_CREDENTIALS`?
3. **Logout status code.** `204` with no body. Confirm, or prefer `200` with a small body?

## Skill use

- Same TDD skill and revision as in Tasks 01–05 (https://github.com/mattpocock/skills, `5863806dd4e15c63174bee4e7515a4256792ecfa`). I did not re-fetch it.
- **Effect on this task:** following `mocking.md` ("mock at system boundaries"), the HTTP tests use an in-memory `AuthService` only to check HTTP mapping. Every authentication rule is tested again through the real service against MySQL in `test/db/auth-api.test.ts`, rather than relying on the stand-in.

## Confirmations

- No Git command was run.
- No `.env` file was read; configuration comes only from the injected environment.
- No later task was started: no Next.js code, cookies, employee, HR-management, or salary endpoints, upload, AI, or MCP.
- `index.md`, `docs/`, and `docs_human/` were not edited.
