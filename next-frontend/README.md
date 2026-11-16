# next-frontend

ACME Compensation Manager web app. Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4, and a few source-owned shadcn/ui components.

```text
Browser → Next.js server (this app) → express-backend → MySQL
```

The browser never calls Express and never sees the session JWT.

## Configuration

All values come from the injected process environment. Nothing in this app reads `.env` files; do not create one (Next.js itself would load it).

| Variable | Required | Meaning |
|---|---|---|
| `API_BASE_URL` | yes | Express base URL, `http(s)://host[:port][/path]`. No credentials, query, or fragment. Server-only. |
| `API_TIMEOUT_MS` | no | Backend request timeout, 100–30000. Default 5000. |
| `API_ASSISTANT_TIMEOUT_MS` | no | Assistant request timeout, 100–120000. Default 50000 (the backend allows 45 s per turn). |
| `DEMO_SHARED_PASSWORD` | no | The public synthetic demo password shown on the sign-in page. Read at request time. |

Never add a `NEXT_PUBLIC_` variable for any of these.

## Commands

```sh
npm run dev              # development server
npm run build && npm start
npm run lint
npm run typecheck        # next typegen + tsc
npm test                 # Vitest unit and component tests
npm run check            # api:check + lint + typecheck + test
npm run api:generate     # regenerate src/generated/ from ../express-backend/openapi/openapi.json
npm run api:check        # fail when src/generated/ is stale
npm run test:e2e         # Playwright, needs a running backend (below)
```

`api:generate` takes only the allowlisted operations (`login`, `getCurrentUser`, `logout`, `listEmployees`, `getEmployee`, `getDirectoryOptions`, `sendAssistantMessages`) and the schemas they reference. It writes `src/generated/api-openapi.json` (runtime response and URL-parameter validation) and `src/generated/api.ts` (types).

## Browser tests

Build first, then run against a real express-backend with seeded demo users:

```sh
npm run build
E2E_API_BASE_URL=http://127.0.0.1:3901 E2E_DEMO_PASSWORD='<synthetic password the demo users were seeded with>' npm run test:e2e
```

Playwright starts: Next.js on 3900 against the backend; Next.js on 3902 against a closed port (outage journeys); a test-only fake of the auth and assistant endpoints on 3905 (`tests/e2e/support/`) with Next.js on 3906 against it, for answer and card rendering without a language model. Projects: `desktop` (1440×900) and `mobile` (390×844). Run the backend without `OPENAI_API_KEY`; the real-backend assistant journey expects `503 ASSISTANT_UNAVAILABLE`.

Each run makes one failed Rohan login. The backend allows five failures per account per 15 minutes, so more than four runs inside 15 minutes against the same backend process will hit `RATE_LIMITED`. Restart the backend to reset it.

## Session cookie

`acme_session` in development, `__Host-acme_session` in production. `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, `Expires` from the backend `expiresAt`.

## Layout

| Path | Purpose |
|---|---|
| `src/server/api/client.ts` | The only module that calls Express. Timeout, Bearer header, error mapping, no body or token logs. |
| `src/server/api/contract.ts` | Runtime validators compiled from the generated contract. |
| `src/server/actions/auth.ts` | `signIn` and `signOut` Server Actions. |
| `src/server/session.ts` | Current HR user lookup (`/api/v1/auth/me`), per-request memoized. |
| `src/proxy.ts` | Redirects `/employees` to sign-in when no session cookie exists. |
| `src/app/session/expired/route.ts` | Re-checks a rejected session and clears the cookie. |
| `src/app/sign-in/` | Sign-in page and form. |
| `src/app/employees/` | Directory (search, filters, sort, paging in the URL) and `[employeeCode]` detail with history. |
| `src/app/assistant/` | Read-only assistant. Conversation in component memory only. |
| `src/server/actions/assistant.ts` | Assistant Server Action: adds the cookie token server-side, maps failures, drops out-of-scope rows. |
