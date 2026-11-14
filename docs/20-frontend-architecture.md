# Frontend architecture

**Status:** Approved design. Implementation waits for employee directory API acceptance.

## Goal

Build the first complete HR browser journey:

```text
Sign in → view permitted employees → search and filter → open employee detail → review compensation history → sign out
```

The human-owned behavior specification is `docs_human/09-frontend-directory.md`.

## Application

Use a Next.js App Router application with React, strict TypeScript, and Tailwind CSS under:

```text
next-frontend/
```

Use selected shadcn/ui components as source-owned components. Do not add a second large component system.

The builder must check the installed Next.js package documentation under `node_modules/next/dist/docs/` before using version-sensitive APIs.

## Frontend and backend boundary

The browser talks to Next.js.

Next.js server code talks to Express.

```text
Browser → Next.js server → Express API → MySQL
```

Use a server-only `API_BASE_URL`. Do not use `NEXT_PUBLIC_API_BASE_URL`.

Browser code must not receive:

- JWTs.
- Authorization headers.
- Database URLs.
- Backend secrets.

The browser must not call Express directly.

## API contract

Generate frontend TypeScript API types from the committed backend OpenAPI document.

Do not maintain a separate handwritten copy of backend response interfaces.

Use one small server-only API client that:

- Adds the Bearer token from the server cookie.
- Applies a timeout.
- Maps backend public errors to frontend result types.
- Handles invalid JSON and unavailable backend responses.
- Does not log response bodies or tokens.

The generated API file must have a repeatable command and a drift check.

## Session cookie

Next.js owns the cookie.

Use:

```text
HttpOnly
SameSite=Lax
Secure in production
Path=/
Expires from the backend session response
```

The sign-in server action:

1. Validates form input.
2. Calls the Express login endpoint.
3. Receives the JWT on the server.
4. Sets the HTTP-only cookie.
5. Redirects to `/employees`.

Protected pages call `/api/v1/auth/me` through server code.

When the backend returns `UNAUTHENTICATED`, clear the cookie and redirect to `/sign-in` with a safe reason code.

The sign-out server action calls backend logout, clears the cookie even if the backend is unavailable, and redirects to sign-in.

## Rendering approach

Prefer Server Components for initial page data.

Use Client Components only for interactions that require browser state, such as a mobile filter sheet or progressive form behavior.

Keep directory state in URL query parameters:

- Search.
- Filters.
- Sort.
- Direction.
- Page.
- Page size.
- Comparison currency.

Opening detail must include a validated return path. Do not accept an external return URL.

## Routes

```text
/sign-in
/employees
/employees/[employeeCode]
```

Use route-specific loading, error, and not-found states.

The first authenticated page is `/employees`.

## Presentation rules

Follow `docs_human/09-frontend-directory.md`.

Key rules:

- Desktop uses a readable data table.
- Mobile uses a reduced table or employee cards.
- Native compensation remains primary.
- USD equivalent is secondary and includes rate context.
- Current, Upcoming, and Historical use text labels, not color alone.
- Historical compensation is labelled `Last recorded compensation`.
- Scoped HR sees a clear permission-filtered notice.
- Monetary values use tabular numbers and do not wrap inside one value.
- Filters use only options returned by the backend.

## Impeccable design process

Impeccable is installed locally at:

```text
.kiro/skills/impeccable/SKILL.md
```

The builder must load and use it for this task.

Required process:

1. Run the Impeccable context command once from the repository root.
2. Initialize product context if the skill requires `PRODUCT.md`.
3. Use shape guidance before UI implementation.
4. Read craft-floor guidance before UI edits.
5. Render the application in a real browser.
6. Review desktop and mobile.
7. Use relevant critique, adapt, harden, audit, and polish guidance.
8. Record concrete design changes caused by the skill.

Do not enable hooks or use live mode without explicit approval.

Also inspect the original Anthropic frontend-design skill and Vercel React/web-design guidance. Record source revisions and concrete effects. The approved product specification overrides external skill preferences.

## Accessibility

Use semantic landmarks, visible labels, keyboard access, visible focus, correct table headers, descriptive page titles, accessible status text, and reduced-motion support.

Do not use color as the only status signal.

## Scope limits

Do not build dashboard analytics, employee mutations, salary changes, HR management pages, upload, AI, or MCP in this task.
