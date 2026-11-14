# Frontend sign-in and directory test plan

**Status:** Approved before frontend implementation

## API contract and client

- Generate types from the committed backend OpenAPI file.
- Fail a drift check when the generated client is stale.
- Add the Bearer token only in server code.
- Apply the configured request timeout.
- Map validation, invalid credentials, unauthenticated, rate limited, not found, and unavailable responses.
- Handle invalid JSON without exposing a stack trace.
- Do not log JWTs, request bodies, or response bodies.

## Sign-in

- Show Meera and Rohan with correct role and scope descriptions.
- Show the shared synthetic demo password.
- Submit selected email and entered password through a server action.
- Set an HTTP-only, SameSite=Lax cookie after successful login.
- Set Secure in production.
- Use backend expiry for the cookie.
- Do not expose the JWT to a Client Component or rendered HTML.
- Show a generic error after incorrect credentials.
- Show a rate-limit message after HTTP 429.
- Preserve the selected demo account after a correctable error.

## Protected routes

- Redirect a signed-out user to `/sign-in`.
- Redirect an expired or revoked session to `/sign-in`.
- Do not redirect an API-unavailable state as if it were sign-out.
- Show current user, role, and scope in the shell.
- Admin shows `All employees`.
- Rohan shows India, Tech, and Support.

## Sign-out

- Call backend logout with the server cookie token.
- Clear the cookie after success.
- Clear the cookie if backend logout is unavailable.
- Redirect to sign-in.
- Repeated sign-out is safe.

## Directory URL state

- Search, filters, sort, direction, page, page size, and comparison currency round-trip through the URL.
- Empty values do not create unnecessary query parameters.
- Changing a filter resets page to 1.
- Clear all removes filters.
- Employee detail receives a safe internal return path.
- Reject an external or malformed return path.

## Directory states

- Render a normal employee page.
- Render no matching employees.
- Render no employee access.
- Render invalid filters.
- Render missing exchange rate.
- Render backend unavailable.
- Render expired session.
- Do not show stale successful data as a fresh response after failure.

## Compensation display

- Show native annual base salary, annual bonus, and annual cash compensation.
- Show currency code with every native amount.
- Show USD equivalent as secondary information.
- Show rate source and effective date.
- Do not calculate authoritative compensation in the frontend.
- Use the exact strings returned by the backend.
- Show Current, Upcoming, and Historical text labels.
- Show `Last recorded compensation` for employees who left.

## Employee detail and history

- Render all approved employee fields.
- Render employee version.
- Render complete compensation history.
- Show `Initial import` for `INITIAL_IMPORT`.
- Preserve directory state when returning from detail.
- Unknown and inaccessible employees use the same public not-found page.

## Responsive behavior

Test desktop and a practical mobile viewport.

- Desktop table remains readable without clipped money.
- Mobile does not force the full desktop table into the viewport.
- Mobile filter sheet opens, traps focus, applies filters, and closes.
- Pagination remains usable on mobile.
- No horizontal page overflow.

## Accessibility

- Sign-in and filter fields have visible labels.
- Keyboard users can sign in, filter, paginate, open detail, return, and sign out.
- Focus remains visible.
- Status is not communicated only by color.
- Loading uses accessible status text.
- Dialog or sheet focus returns to its trigger.
- Automated accessibility scan has no serious or critical findings on the three main routes.

## Browser journeys

### Admin HR

```text
Sign in as Meera → view all employees → search by exact ID → open detail → inspect history → return with filters preserved → sign out
```

### Scoped HR

```text
Sign in as Rohan → see scope notice → view permitted employee → search for known out-of-scope employee → receive no disclosure → sign out
```

Run each journey on desktop. Run the main directory and filter journey on mobile.

## Impeccable evidence

Record:

- Impeccable context and references used.
- Initial visual direction.
- Desktop and mobile captures.
- At least one critique finding.
- The code or design change made from that finding.
- Final detector or audit result.

Installation alone is not evidence.

## Regression

The frontend task must not change backend behavior. Run backend contract generation and selected backend checks where the frontend depends on them.
