# Fix 06a: Login rate-limit key for the Next.js server path

**Instruction:** `builder_docs/parent_instructions/06a-auth-rate-limit-fix.md`
**Result:** Applied and verified. Not committed.
**Scope kept:** only the login rate-limit key and its tests and documentation. No Next.js, employee, or directory code. Task 07 was not started.

## Files changed (in `express-backend/`)

| File | Change |
|---|---|
| `src/http/rate-limit.ts` | New `emailKeyPart()` and `loginLimitKey()`. The limiter's `keyGenerator` now uses the combined key and creates a random 32-byte HMAC key per limiter. `failedLoginLimiter()` accepts an optional injected `store`. `ClockedMemoryStore.keys()` lists live keys for tests. `clientKey()` (socket and Railway rules), `limit`, `windowMs`, and `skipSuccessfulRequests` are unchanged. |
| `src/http/app.ts` | Optional `rateLimitStore` dependency, passed to the limiter (tests use it to inspect state). |
| `src/http/openapi.ts`, `openapi/openapi.json` | Login description now says "per caller and email address"; contract regenerated. |
| `test/http-rate-limit.test.ts` | 7 new tests (16 in the file). The 9 existing tests are unchanged. |
| `README.md` | Failed-login limit section describes the new key. |

## Key format

```text
ip:<caller key>|email:<64 lowercase hex characters>
ip:<caller key>|email:none
```

- **`<caller key>`** comes from the unchanged `clientKey()`:
  - The socket peer address, or a valid `X-Real-IP` in `railway-x-real-ip` mode.
  - IPv6 grouped to /56 by `ipKeyGenerator`.
  - `unknown-client` when no valid address is available.
- **The email part** is HMAC-SHA256 of the email normalized with the same `normalizeEmail()` that sign-in uses (`trim().toLowerCase()`).
  - The HMAC key is random per process and never leaves memory. Limiter state therefore holds neither the plain email nor a plain hash that could be matched against a list of known addresses.
  - Example shape: `ip:203.0.113.40|email:` followed by 64 hex characters.
- **`none`** is the sentinel for a missing body, a missing `email`, or a non-string `email` (number, null, array, object). Each caller has one such bucket, so malformed requests cannot create unbounded state.
- **Timing.** The key is computed before body validation, so malformed requests still count as failures, as before.

## Tests

| Test (new unless marked) | Detects |
|---|---|
| A different email from the same caller has a separate allowance, and another account still signs in through that caller after one account is blocked | One bucket per caller: 5 failures blocking every user behind the Next.js server |
| Five case or space variants of one email share one allowance; the 6th attempt → 429 | Variants buying extra attempts |
| The same email from a different caller IP has a separate allowance | Dropping the caller part |
| Missing, number, null, array, and object emails share one sentinel bucket (5 × 400, then 429; the store holds exactly 1 key); a real email from that caller stays separate | Fresh buckets for malformed input; unbounded state |
| Socket mode: rotating spoofed `X-Real-IP`/`X-Forwarded-For` for one email → 429 on the 7th request | Forwarded headers becoming effective |
| Every store key matches `^ip:[0-9a-f:.]+\|email:[0-9a-f]{64}$` and contains no part of the email; captured logs contain no email | Plain email in limiter state or logs |
| 4 failures, 3 successes, then the 5th failure → 401 and the 6th → 429 (email-keyed) | Successes counted against the email bucket |
| Existing 9 rate-limit tests (unchanged) | Window, separate IPs, Railway mode, `X-Forwarded-For` ignored, `/health` not limited |

## Failed tests actually observed

- **On the old caller-only key,** 3 of the 7 new tests failed:
  - "a different email from the same caller has a separate allowance";
  - "missing and non-string emails share one bounded sentinel bucket per caller", where the bucket was shared with real emails, so a real email was blocked;
  - "limiter state and logs never contain the plain email", where keys did not match the new format.
- **The other 4 new tests passed on the old key,** because they describe properties the caller-only key already had: case variants, a different IP, spoofed headers, successes not counted.
- **Mutation check:** with `normalizeEmail()` removed from the hash input, "email case and surrounding spaces share one allowance" failed. Restored; the marker search found 0.

## Commands and results

Run from `express-backend/`:

| Command | Result |
|---|---|
| `npm run openapi:generate` | regenerated `openapi/openapi.json` (contains the new description) |
| `npm run check` (lint, typecheck, fast tests) | exit 0; 263 tests, 263 pass (256 before + 7 new) |
| `npm run build` | exit 0 |
| `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db` | 137 tests, 137 pass |

Existing authentication, OpenAPI (including the drift test), process, and MySQL tests all pass unchanged.

## Known limitations

- **Distributed guessing against one account.** It is limited only per caller. Through the Next.js server all users share one caller, so the backend allows 5 failures per account per 15 minutes from that server.
- **Credential stuffing across many accounts.** Many different emails from one caller are not limited here. The planned browser-IP limit at the Next.js boundary should cover that.
- **Restarts.** The HMAC key and counts are per process and reset on restart, as before.

## Confirmations

- No Git command was run.
- No `.env` file was read.
- No Next.js, employee-route, or directory code was added, and Task 07 was not started.
- `index.md`, `docs/`, and `docs_human/` were not edited.
