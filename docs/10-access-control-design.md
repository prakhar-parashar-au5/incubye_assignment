# HR access-control design

**Status:** Approved design. Implementation waits for Task 03 acceptance.

## Roles

### Admin HR

Admin HR can:

- View all employees and compensation records.
- Change compensation for any employee.
- Create HR users.
- Activate or deactivate HR users.
- Change country and department scopes.
- View access-change history.

### Scoped HR

Scoped HR can:

- View employees inside the assigned scope.
- View compensation inside the assigned scope.
- Change compensation inside the assigned scope.
- View their own compensation-change history.

Scoped HR cannot manage HR users or access scopes.

## Scope rule

A scoped HR user has a list of countries and a list of departments.

Access requires:

```text
employee country IN assigned countries
AND
employee department IN assigned departments
```

Matching within each list uses OR.

Example:

```text
countries: IN, US
departments: Tech, HR
```

The user can access:

```text
IN + Tech
IN + HR
US + Tech
US + HR
```

An empty country list or empty department list grants no employee access.

The backend enforces this rule. Frontend visibility is not an authorization control.

## HR users

Store:

- Internal numeric ID.
- Email.
- Display name.
- Password hash.
- Role: `ADMIN` or `SCOPED`.
- Status: `ACTIVE` or `INACTIVE`.
- Version for concurrent updates.
- Creation and update timestamps.

Email is unique without case sensitivity.

Never store or log a plain-text password.

The builder must select a maintained password-hashing method that is suitable for Node.js and Railway. The choice and parameters must be documented. Password comparison must use the library's safe verification function.

## Sessions

The session lifetime is two hours.

After valid sign-in, the backend creates a session record and a signed JWT.

The JWT contains only:

- HR user ID.
- Session ID.
- Issued time.
- Expiry time.

It does not contain role, status, countries, or departments.

The session table stores:

- Session ID.
- HR user ID.
- Expiry time.
- Revoked time.
- Creation time.

For each authenticated request, the backend:

1. Verifies the JWT signature and expiry.
2. Loads the matching session.
3. Rejects a missing, expired, or revoked session.
4. Loads the current HR user.
5. Rejects an inactive HR user.
6. Loads current country and department scopes.
7. Applies authorization to the requested operation.

This database lookup makes deactivation and scope changes effective on the next request.

Sign-out revokes the session.

## Cookie

The Next.js frontend stores the JWT in a cookie with:

```text
HttpOnly
Secure in deployment
SameSite=Lax
Path=/
```

Browser JavaScript cannot read the JWT.

The frontend sends authenticated requests through its server-side code. The backend remains the authority for session and access checks.

## Proposed tables

### `hr_users`

- `id`
- `email`
- `display_name`
- `password_hash`
- `role`
- `status`
- `version`
- `created_at`
- `updated_at`

### `hr_user_country_scopes`

- `hr_user_id`
- `country_code`

Use a composite primary key.

### `hr_user_department_scopes`

- `hr_user_id`
- `department_id`

Use a composite primary key.

### `hr_sessions`

- `id`
- `hr_user_id`
- `expires_at`
- `revoked_at`
- `created_at`

### `access_audit_events`

- `id`
- `actor_hr_user_id`
- `target_hr_user_id`
- `action`
- `before_state`
- `after_state`
- `created_at`

The before and after states can contain role, status, countries, and departments. They must never contain passwords, password hashes, JWTs, or session IDs.

## Audit rules

Creating an HR user, changing scopes, activation, and deactivation must create an audit event.

The HR change and audit event must commit in one transaction.

The audit record contains:

- Who made the change.
- Which HR user changed.
- What changed.
- Previous state.
- New state.
- Time of change.

Normal application operations do not update or delete audit events.

## Demo accounts

The demo will have:

```text
Meera Iyer
Role: ADMIN
Access: all employees
```

```text
Rohan Mehta
Role: SCOPED
Countries: IN
Departments: Tech, Support
```

The public demo credentials must be labelled as synthetic demo access. The database stores only password hashes.

## Security rules

- Use generic sign-in errors.
- Rate-limit sign-in attempts before public deployment.
- Keep JWT signing keys in injected server environment values.
- Do not put signing keys in source code or frontend code.
- Do not log passwords, JWTs, cookies, salaries, or database URLs.
- Validate all inputs at the backend boundary.
- Check authorization inside application operations, not only route handlers.

## Deferred work

This design does not include:

- Enterprise single sign-on.
- Password reset.
- Multi-factor authentication.
- Custom roles.
- Per-employee access grants.
- Paired country and department scopes.
- Long-lived refresh tokens.
