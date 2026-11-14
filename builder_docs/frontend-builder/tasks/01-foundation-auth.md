# Frontend Task 01: Next.js foundation and authentication shell

**Status:** READY

## Goal

Create the independent Next.js frontend and complete this bounded journey:

```text
Open sign-in → choose a demo user → enter shared demo password → sign in through Express → store JWT in an HTTP-only cookie → view protected employee shell → sign out
```

Do not integrate employee directory data in this task. Backend Task 07 is still in progress.

## Read first

- `docs/requirements.md`
- `docs_human/09-frontend-directory.md`
- `docs/20-frontend-architecture.md`
- `docs/21-frontend-test-plan.md`
- `docs/14-authentication-api-design.md`
- `express-backend/openapi/openapi.json`
- `builder_docs/responses/06-authentication-api.md`
- `builder_docs/responses/06-authentication-api-fix.md`
- `.kiro/skills/impeccable/SKILL.md`

Treat the current backend OpenAPI file as authoritative for authentication. Do not edit it.

## Impeccable requirement

Impeccable is installed locally at `.kiro/skills/impeccable/`.

From the repository root:

1. Run the skill context command once.
2. Initialize product context if required.
3. Use shape guidance before implementation.
4. Read craft-floor guidance before UI edits.
5. Render the real sign-in and protected shell.
6. Review desktop and mobile.
7. Use relevant critique, adapt, harden, audit, and polish guidance.
8. Record at least one design decision and one correction caused by the skill.

Do not enable hooks. Do not use live mode without explicit approval.

Also inspect the original Anthropic frontend-design skill and Vercel React/web-design guidance. Record exact sources, revisions, files read, and concrete effects. Do not install overlapping global packages without approval.

## Framework setup

Create the application under `next-frontend/` with:

- Next.js App Router.
- React.
- Strict TypeScript.
- Tailwind CSS.
- Selected shadcn/ui source components.

Use current stable versions that are compatible with the selected Node version. Check official documentation.

After installation, read the relevant installed Next.js guidance under:

```text
next-frontend/node_modules/next/dist/docs/
```

Do this before using version-sensitive APIs such as cookies, server actions, route parameters, redirects, or request APIs.

## API client

Generate TypeScript types from:

```text
express-backend/openapi/openapi.json
```

Add a repeatable command. Do not create handwritten duplicate response types.

Create one server-only API client. It must:

- Read `API_BASE_URL` from server environment configuration.
- Reject missing or invalid configuration without printing values.
- Add Bearer JWT only on the server.
- Apply a request timeout.
- Map public backend errors.
- Handle invalid JSON and backend unavailability.
- Avoid response-body and token logs.

The browser must not call Express directly.

## Demo password

Read the shared public demo password from a server environment value such as:

```text
DEMO_SHARED_PASSWORD
```

The sign-in page intentionally renders this public synthetic password. Do not use a `NEXT_PUBLIC_` variable. Tests inject a labelled synthetic value.

Do not create or read `.env` files.

## Sign-in

Show Meera and Rohan with their approved roles and scope descriptions.

The user selects one account. Use that account's approved email. The user enters or copies the shared password.

The sign-in server action calls `POST /api/v1/auth/login`.

On success, set a cookie with:

```text
HttpOnly
SameSite=Lax
Secure in production
Path=/
Expires from backend expiresAt
```

Then redirect to `/employees`.

On invalid credentials or rate limit, show a clear public error and preserve the selected account.

Do not render or serialize the JWT.

## Protected shell

Create a protected `/employees` route.

For this task, it contains:

- Application navigation shell.
- Current HR name.
- Role.
- Scope summary.
- Employee page heading.
- A clear loading placeholder area reserved for directory content.
- Sign-out action.

Do not invent employee rows or a directory response.

Protected rendering calls `GET /api/v1/auth/me` through the server-only client.

If the backend returns `UNAUTHENTICATED`, clear the cookie and redirect to sign-in.

If the backend is unavailable, show a retryable service error. Do not treat this as sign-out.

## Sign-out

The sign-out server action calls `POST /api/v1/auth/logout` with the server cookie token.

Clear the cookie even if backend logout is unavailable. Redirect to sign-in.

## Visual requirements

Use the approved calm HR operations direction.

The sign-in page and shell must feel like the same product. Avoid generic AI dashboard styling.

Do not create clickable controls for unavailable future pages. A small non-interactive status label is acceptable.

Test practical desktop and mobile widths.

## Required tests

Add focused tests for:

- Generated authentication contract types.
- Server-only API configuration and error mapping.
- Successful login server action.
- HTTP-only cookie flags.
- Invalid credentials.
- Rate limit response.
- Protected redirect when signed out.
- Protected current-user rendering.
- Backend-unavailable state.
- Sign-out revocation call and cookie removal.
- JWT absent from rendered HTML and Client Component props.
- Keyboard sign-in and sign-out.
- Desktop and mobile layout.

Use a small browser journey against the real Express authentication API where practical. Use test-only synthetic environment values. Do not read `.env` files.

## Required checks

Run:

```text
lint
typecheck
unit/component tests
production build
browser tests
Impeccable detector or audit on source and rendered routes
```

## Scope limits

Do not:

- Modify backend files.
- Implement employee directory API integration.
- Create mock employee data in production UI.
- Build dashboard analytics.
- Build salary changes.
- Build HR management pages.
- Build upload, AI, or MCP.

## Response

Write:

```text
builder_docs/frontend-builder/responses/01-foundation-auth.md
```

Include:

- Versions and official docs checked.
- Impeccable and other skill evidence.
- Files changed.
- API and cookie design.
- Tests and failures actually observed.
- Browser routes and viewport sizes checked.
- Design review findings and fixes.
- Exact commands and results.
- Known limitations.
- Confirmation that no backend, Git, or future frontend task was touched.
