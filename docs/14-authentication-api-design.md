# Authentication API design

**Status:** Approved design. Implementation waits for the TypeScript migration.

## Goal

Create the first Express HTTP server and expose authentication for the Next.js application.

The Express backend owns credentials, sessions, authorization data, and JWT creation. The Next.js server owns the browser cookie.

## Request flow

```text
Browser
  → Next.js server action
  → Express authentication API
  → JWT returned to Next.js server
  → Next.js stores JWT in an HTTP-only cookie
```

Browser JavaScript does not receive or store the JWT.

For protected calls, Next.js server code sends:

```http
Authorization: Bearer <JWT>
```

The browser does not call Express directly. Browser CORS access is disabled by default.

## Endpoints

### Health

```http
GET /health
```

Public response:

```json
{
  "status": "ok"
}
```

The health response must not expose configuration, database details, or dependency versions.

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

Request:

```json
{
  "email": "meera.iyer@acme.com",
  "password": "public-demo-password"
}
```

The request object is strict. Reject unknown fields.

Successful response:

```json
{
  "token": "signed-jwt",
  "expiresAt": "2026-11-14T12:00:00.000Z",
  "user": {
    "id": 1,
    "displayName": "Meera Iyer",
    "email": "meera.iyer@acme.com",
    "role": "ADMIN"
  }
}
```

Unknown email, incorrect password, and inactive user return the same public error.

### Current user

```http
GET /api/v1/auth/me
Authorization: Bearer <JWT>
```

Response:

```json
{
  "user": {
    "id": 1,
    "displayName": "Meera Iyer",
    "email": "meera.iyer@acme.com",
    "role": "ADMIN",
    "status": "ACTIVE"
  },
  "scope": {
    "countries": [],
    "departments": []
  },
  "session": {
    "expiresAt": "2026-11-14T12:00:00.000Z"
  }
}
```

The endpoint loads current user status and scopes. It does not copy role or scope from the JWT.

### Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <JWT>
```

Logout revokes the database session.

Logout is safe to repeat while the signed JWT itself remains valid. An already revoked session returns success.

The later Next.js action deletes the browser cookie after the backend response.

### OpenAPI

```http
GET /api/v1/openapi.json
```

The backend generates the API contract from the same schemas used for runtime validation where practical. The frontend will generate TypeScript API types from this contract.

## Public errors

Use one response shape:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email or password is incorrect."
  }
}
```

Approved codes:

- `VALIDATION_ERROR`
- `INVALID_CREDENTIALS`
- `UNAUTHENTICATED`
- `RATE_LIMITED`
- `NOT_FOUND`
- `INTERNAL_ERROR`

Do not return stack traces, SQL errors, internal authentication reasons, or library messages.

## Runtime validation

Use Zod to validate:

- Request bodies.
- Route parameters.
- Query parameters.
- Environment configuration.
- Delivery response construction where useful.

TypeScript validates application code. Zod validates values received at runtime.

## Authentication middleware

The middleware must:

1. Require one Bearer token.
2. Call the existing authentication operation.
3. Load the current database session, HR user, and scopes.
4. Put the typed principal in request context.
5. Return the generic `UNAUTHENTICATED` response after any authentication failure.

Do not expose internal reasons such as `SESSION_REVOKED` or `USER_INACTIVE` to the client.

## Login rate limit

Allow five failed login attempts from one client IP in 15 minutes.

A successful login must not consume the failed-attempt limit.

The builder must verify Express proxy configuration for Railway before trusting the client IP. Do not use an unverified proxy setting.

Return HTTP `429` with code `RATE_LIMITED` when the limit is reached.

## Demo credentials

Meera and Rohan use one shared public demo password.

The password is synthetic demo access. It is not a production secret.

The backend database stores only separate Argon2id hashes. The same plain password can produce different stored hashes because each hash uses a random salt.

The actual public password value will be selected before the frontend login page is built. The deployed demo-user seed receives it through injected environment values.

## Logging

Permitted request log fields:

- Request identifier.
- HTTP method.
- Route pattern or path without query values.
- Status code.
- Duration.

Never log:

- Request bodies.
- Passwords.
- Password hashes.
- JWTs.
- Authorization headers.
- Cookies.
- Salary values.
- Database URLs.
- SQL parameters.

## Server design

Create an Express application factory that accepts dependencies. Tests must create the application without opening a second hidden database connection.

Create a separate process entry point that reads validated environment values, creates the pool and services, starts the server, and closes resources on termination.

Use a small JSON body limit. Disable the `X-Powered-By` header.

Do not add employee routes in this task.

## Scope limits

This task does not include:

- Next.js pages or cookies.
- Employee directory endpoints.
- HR-user management endpoints.
- Salary endpoints.
- Spreadsheet upload.
- OpenAI or MCP.
