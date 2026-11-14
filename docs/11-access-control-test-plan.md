# HR access-control test plan

**Status:** Approved before access implementation

## Scope-rule unit tests

- Admin HR can access every employee.
- Scoped HR can access an employee when country and department both match.
- Reject when only country matches.
- Reject when only department matches.
- Reject when neither matches.
- Multiple countries use OR within the country list.
- Multiple departments use OR within the department list.
- Country and department lists use AND across dimensions.
- An empty country list grants no access.
- An empty department list grants no access.

## Schema integration tests

- Create the five approved access tables.
- Enforce unique HR email without case sensitivity.
- Reject unsupported role and status values.
- Start HR user version at `1`.
- Reject country scope for an unknown HR user.
- Reject department scope for an unknown HR user.
- Reject unknown country and department assignments.
- Reject duplicate country or department scope rows.
- Prevent deletion of referenced HR users and scope reference data unless an approved cleanup rule says otherwise.
- Store session expiry and optional revocation time.
- Store access audit before and after states as valid JSON.

## Password tests

- Store a password hash, not the submitted password.
- Correct password verifies.
- Incorrect password fails.
- Two hashes of the same password use different salts when the selected method supports salts.
- Password values do not appear in logs or errors.

## Session tests

- Valid credentials create a two-hour session.
- JWT contains only approved claims.
- JWT does not contain role or scope data.
- Invalid signature fails.
- Expired JWT fails.
- Missing database session fails.
- Revoked session fails.
- Inactive HR user fails on the next request.
- Sign-out revokes the database session.

Use an injected clock for deterministic expiry tests. Do not wait for real time to pass.

## Current-access tests

- A scope addition affects the next authorization check.
- A scope removal affects the next authorization check.
- Changing an HR user to inactive blocks the next request.
- A previously issued JWT does not preserve old scopes.
- Scoped HR cannot manage HR users.
- Admin HR can manage HR users.

## Audit transaction tests

- Creating an HR user writes one audit event.
- Changing country scopes writes old and new states.
- Changing department scopes writes old and new states.
- Activation and deactivation write audit events.
- Audit state never contains a password hash, JWT, or session ID.
- A forced audit insert failure rolls back the HR user or scope change.

## Delivery tests for the later API task

- Valid sign-in sets the expected HTTP-only cookie through the frontend flow.
- Sign-in uses a generic error for unknown email and incorrect password.
- Protected endpoints reject a missing cookie.
- Protected endpoints reject expired and revoked sessions.
- Cookie uses `Secure` in deployment and `SameSite=Lax`.
- Sign-out clears the cookie and revokes the session.

## Test quality

- Use small hand-written HR users and employees.
- Use real MySQL for schema, session, scope, and transaction behavior.
- Use unit tests for the pure scope rule.
- Inject time and token-signing dependencies where practical.
- Do not log credentials in failed assertions.
- Explain the defect that each important test can detect.
