# Task 06 review fix: BFF-safe login rate-limit key

**Status:** READY

## Problem

The approved request path is:

```text
Browser → Next.js server → Express authentication API
```

A limiter that uses only the Express network peer can place all Next.js users in one bucket. Five failed attempts by some users could block every login through that Next.js service.

## Approved rule

Limit five failed login attempts for one normalized email and caller network key in 15 minutes.

Build the key from:

```text
clientKey(request) + hash(normalized email)
```

Requirements:

- Normalize the email in the same way as authentication where practical.
- Hash the normalized email before it enters a rate-limit key.
- Do not store or log the plain email in limiter state.
- Use a stable sentinel for a missing or non-string email.
- Keep socket and Railway client-key rules unchanged.
- Keep `skipSuccessfulRequests` behavior.
- Do not change the approved limit or window.

This backend limit prevents one account from consuming another account's allowance through the BFF. A browser-IP limit at the Next.js boundary remains future work.

## Required tests

- Five failures for one email and caller key are allowed; the sixth is blocked.
- A different normalized email from the same caller has a separate allowance.
- Email case and surrounding spaces use the same allowance.
- The same email from a different valid caller IP has a separate allowance.
- Missing and non-string emails use a bounded shared sentinel bucket for that caller.
- Spoofed forwarding headers remain ineffective in socket mode.
- Rate-limit state and captured logs do not contain the plain email.
- Successful login does not consume the failed-attempt allowance.
- Existing authentication, OpenAPI, process, and MySQL tests still pass.

## Scope

Change only the login rate-limit key and related tests or documentation.

Do not add Next.js code, employee routes, or directory code. Do not start Task 07.

## Verification

Run:

```text
npm run check
npm run build
DATABASE_URL=<test database URL> npm run test:db
```

## Response

Write:

```text
builder_docs/responses/06-authentication-api-fix.md
```

Include files changed, key format without real emails, tests, failed tests actually observed, commands, results, and confirmation that no Git or later-task work ran.
