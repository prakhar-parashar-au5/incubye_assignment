# Authentication API test plan

**Status:** Approved before API implementation

## Application construction

- Create the Express application with injected dependencies.
- Application construction does not start a network listener.
- Unknown routes return the standard JSON error.
- Disable `X-Powered-By`.
- Reject JSON bodies above the configured limit.

## Health endpoint

- `GET /health` returns HTTP 200 and `{ "status": "ok" }`.
- The response does not contain database, environment, package, or host information.

## Login validation

- Accept a valid email and password object.
- Reject a missing email.
- Reject a missing password.
- Reject non-string values.
- Reject an invalid email format.
- Reject an unknown request field.
- Reject malformed JSON.
- Return the standard `VALIDATION_ERROR` shape.
- Do not include the submitted values in the response or logs.

## Login behavior

Using real MySQL:

- Valid Meera credentials return a token, two-hour expiry, and Admin user summary.
- Valid Rohan credentials return a token and Scoped user summary.
- Unknown email returns `INVALID_CREDENTIALS`.
- Incorrect password returns the identical public response.
- Inactive user returns the identical public response.
- Login response does not include password hash, status internals, or scopes.

## Rate limit

- Five failed attempts from one IP are allowed within 15 minutes.
- The next failed attempt returns HTTP 429 and `RATE_LIMITED`.
- Another IP has a separate limit.
- A successful login does not consume the failed-attempt allowance.
- Tests use an injected clock or limiter store. They do not wait 15 minutes.
- Proxy configuration does not trust arbitrary forwarded IP headers outside the approved deployment mode.

## Authentication middleware

- Missing Authorization header returns `UNAUTHENTICATED`.
- Wrong authorization scheme returns `UNAUTHENTICATED`.
- Empty token returns `UNAUTHENTICATED`.
- Invalid signature returns `UNAUTHENTICATED`.
- Expired JWT returns `UNAUTHENTICATED`.
- Missing database session returns `UNAUTHENTICATED`.
- Revoked session returns `UNAUTHENTICATED`.
- Inactive HR user returns `UNAUTHENTICATED`.
- All public authentication failure bodies are identical where required.
- Internal failure reasons do not enter the response.

## Current-user endpoint

- Admin response contains current role and empty scope lists.
- Scoped response contains current country and department lists.
- A scope change appears on the next `/me` request with the same JWT.
- HR deactivation blocks the next `/me` request.
- Response does not contain password hash, JWT, session ID, or audit data.
- Session expiry is returned as an ISO timestamp.

## Logout endpoint

- Logout revokes the matching database session.
- The token fails on the next `/me` request.
- Repeated logout returns success while the JWT remains cryptographically valid.
- Logout cannot revoke another user's session.
- Response does not return the token or session ID.

## OpenAPI contract

- Contract includes health, login, current-user, logout, and OpenAPI endpoints.
- Login request marks email and password as required.
- Login response includes token, expiry, and user summary.
- Current-user response includes current scopes.
- Security scheme uses HTTP Bearer JWT.
- Error schemas contain approved public codes.
- A generated contract file does not drift from runtime schemas.

## Logging tests

Capture application log output and confirm that it does not contain:

- Test password.
- Password hash.
- JWT.
- Authorization header.
- Cookie value.
- Database URL.
- Request body.

Confirm that the log contains method, safe path, status, and duration.

## Process smoke tests

- Missing required environment configuration stops startup with a short error.
- The error does not print secret values.
- Compiled server starts and answers `/health`.
- Termination closes the HTTP server and database pool.

## Regression

Run all previous fast and real-MySQL tests.

The API task must not change workbook, seed, migration, compensation, session, access, or audit behavior.
