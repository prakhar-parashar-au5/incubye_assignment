# HR access-management specification

## User and problem

Only Admin HR uses access management.

The feature replaces spreadsheet and message-based tracking of which HR user can see which employees. It gives ACME one controlled place to create HR users, assign access, deactivate access, and review history.

Scoped HR cannot manage HR users.

## Main journey

1. Admin opens HR Access.
2. Admin sees active HR users, roles, and scope summaries.
3. Admin searches by name or email and filters by role, status, country, or department.
4. Admin selects Add HR user or opens an existing HR user.
5. Admin enters or changes the allowed fields.
6. The system shows an exact access preview.
7. Admin confirms with the current expected user version.
8. The backend rechecks Admin authority and current target version.
9. The change and audit event commit in one transaction.
10. The page shows the updated HR user and audit history.

The feature never hard-deletes an HR user. “Remove user” is labelled “Deactivate access”.

## HR user list

Show:

- Display name.
- Email.
- Role.
- Status.
- Country scopes.
- Department scopes.
- Access summary.
- Version.
- Last updated time.

Active users appear by default. Admin can select Include inactive users to find and reactivate them.

Search supports case-insensitive partial name and exact email.

Filters:

- Role.
- Status.
- Country scope.
- Department scope.

For an Admin HR user, country and department filters treat the user as “All employees”, not as having stored scope rows.

Default sort is last updated time, newest first. Also support name and email sorting.

Use server-side filtering, sorting, and pagination. Default page size is 25 and maximum is 100.

## Create HR user

Admin HR can create:

- Another Admin HR user.
- A Scoped HR user.

Scoped HR cannot create any HR user.

Required fields:

- Display name.
- Email.
- Role.
- Country scopes for Scoped HR.
- Department scopes for Scoped HR.

An Admin HR user must have empty country and department scopes.

A new Scoped HR user must have at least one country and one department in this workflow. The lower-level policy can still represent empty scopes safely, and empty scopes grant no employee access.

Email is unique without case sensitivity and cannot change after account creation.

## Initial password

The backend generates a random temporary password when an HR user is created.

The creation response shows the temporary password one time to the Admin who created the user. The password is never available again through the application.

The database stores only the password hash. The password must not appear in application logs, audit events, URLs, analytics, or later API responses.

Email delivery is not implemented in this version. The UI must not claim that an email was sent. Admin must share the temporary password through an approved channel outside this demo.

Password reset and forced first-login password change are deferred.

## Edit HR user

Editable fields:

- Display name.
- Country scopes for Scoped HR.
- Department scopes for Scoped HR.
- Status through explicit activate or deactivate actions.
- Role from Scoped HR to Admin HR.

Email cannot change.

Role can change from `SCOPED` to `ADMIN`.

Role cannot change from `ADMIN` to `SCOPED` in this version.

Promoting Scoped HR to Admin HR removes all country and department scope rows in the same transaction. The resulting Admin account has access to all employees.

Role change revokes all existing sessions for the target HR user. The user must sign in again.

Display-name changes do not revoke sessions.

Scope changes do not need to revoke sessions because every authenticated request loads current scopes from MySQL. The new scope applies on the next request.

## Scope selection

The current rule is:

```text
employee country IN assigned countries
AND
employee department IN assigned departments
```

Use multi-select controls for countries and departments.

Show the resulting cross-product before confirmation.

Example display:

```text
Countries: India, United States
Departments: Tech, Support
Result: India + Tech, India + Support, United States + Tech, United States + Support
```

Show the estimated number of accessible employees before confirmation. The backend calculates this count with the current employee data and scope policy.

If either list is empty, show:

```text
This scope grants access to no employees.
```

The current create workflow requires at least one country and department for Scoped HR. If an existing Scoped HR user has empty scopes from older data, the page must still render safely and explain that they have no employee access.

## Access preview

Before save, show:

- Old and new display name when changed.
- Old and new role.
- Old and new status.
- Old and new country scopes.
- Old and new department scopes.
- Old and new access summary.
- Estimated accessible employee count.
- Sessions that will be revoked.

A separate confirmation action is required for:

- Creating an HR user.
- Promoting Scoped HR to Admin HR.
- Replacing scopes.
- Deactivating or reactivating an HR user.

Preview writes nothing.

Editing any input makes the existing preview stale and requires a new preview.

## Activation and deactivation

Inactive HR users can be reactivated.

An Admin can deactivate themselves only when another active Admin exists.

The last active Admin cannot be deactivated.

Blocked message:

```text
You cannot deactivate the last active Admin HR user. Activate or create another Admin first.
```

Deactivation immediately revokes all active sessions for the target user in the same transaction. The next authenticated request fails.

Reactivation restores the user's stored role and scopes. It does not restore old sessions. The user must sign in again.

Deactivation requires a reason note of at most 2,000 characters.

Reactivation requires a short reason note.

## Concurrency

Every preview and update uses `expectedVersion` from `hr_users.version`.

Scenario:

```text
Admin A and Admin B open HR user version 4.
Admin A changes country access and creates version 5.
Admin B submits a department change using expectedVersion 4.
```

Admin B receives HTTP 409 `STALE_VERSION`. No change or audit event is written.

The page reloads current state and shows Admin B's unsaved choices beside it. Admin B must preview and confirm again.

The backend locks the target HR user row before comparing version and changing role, scope, or status.

Last-active-Admin operations also lock active Admin rows in the established order.

## Audit history

Each access audit event shows:

- Actor.
- Target HR user.
- Action.
- Previous role, status, countries, and departments.
- New role, status, countries, and departments.
- Reason note when applicable.
- Time.
- Resulting HR user version.

Only Admin HR can view access audit history.

Scoped HR cannot view this page or their own access history in this version.

Audit events are immutable. They cannot be edited or deleted through application operations.

No-change submissions write no audit event and do not increment version.

Audit data never contains passwords, password hashes, JWTs, session IDs, cookies, or authorization headers.

The HR change, session revocation, version increment, and audit event must commit in one transaction.

## Permissions

Scoped HR cannot open access-management APIs or pages.

An authenticated Scoped HR request receives HTTP 403 `FORBIDDEN`.

The frontend can hide Admin navigation from Scoped HR, but backend application operations remain the authority.

Every create, preview, scope, role, status, session-revocation, and audit-read operation checks the current actor in MySQL.

Access changes apply on the target user's next request.

## API behavior

List and detail:

```text
GET /api/v1/hr-users
GET /api/v1/hr-users/:hrUserId
GET /api/v1/hr-users/:hrUserId/access-audit
```

Create:

```text
POST /api/v1/hr-users
POST /api/v1/hr-users/preview
```

Profile and role:

```text
POST /api/v1/hr-users/:hrUserId/profile/preview
POST /api/v1/hr-users/:hrUserId/profile
POST /api/v1/hr-users/:hrUserId/promote/preview
POST /api/v1/hr-users/:hrUserId/promote
```

Scopes:

```text
POST /api/v1/hr-users/:hrUserId/scopes/preview
PUT  /api/v1/hr-users/:hrUserId/scopes
```

Country and department scopes are replaced together in one request. This avoids an intermediate state where only one dimension changed.

Status:

```text
POST /api/v1/hr-users/:hrUserId/deactivate/preview
POST /api/v1/hr-users/:hrUserId/deactivate
POST /api/v1/hr-users/:hrUserId/reactivate/preview
POST /api/v1/hr-users/:hrUserId/reactivate
```

All writes require:

- Valid Admin session.
- Expected target version where a target already exists.
- Idempotency key.
- Exact confirmed preview.

Public errors:

```text
400 VALIDATION_ERROR
403 FORBIDDEN
404 NOT_FOUND
409 STALE_VERSION
409 DUPLICATE_OPERATION
409 LAST_ACTIVE_ADMIN
409 EMAIL_TAKEN
422 INVALID_SCOPE
503 SERVICE_UNAVAILABLE
```

## Page states

### Loading

Show stable skeletons for list, detail, and audit history.

### Empty list

Show:

```text
No HR users match these filters.
```

Provide Clear filters.

### Existing Scoped HR with no access

Show:

```text
This HR user currently has access to no employees.
```

Provide Change scope.

### Validation failure

Show field errors and a summary. Keep entered values.

### Duplicate email

Show:

```text
An HR user with this email already exists.
```

Do not reveal password or account internals.

### Stale version

Show current state and unsaved proposed state. Require a new preview and confirmation.

### Last active Admin blocked

Show the approved blocked message. Do not change status, version, sessions, or audit history.

### Audit failure

Show that no change was applied. The transaction must roll back.

### Success

Show the resulting role, status, scopes, employee count, and version. Show the one-time temporary password only after successful creation.

### Backend unavailable

Show a retry action. Do not claim that an uncertain mutation succeeded. Reuse the same idempotency key when retrying the same operation.

## Tests I expect

### Permissions

- Admin can list and view HR users.
- Scoped HR cannot list, create, edit, deactivate, reactivate, promote, or view audit history.
- Frontend hiding Admin controls does not replace backend checks.
- An inactive Admin cannot manage HR users.

### Creation

- Admin creates a valid Scoped HR user.
- Admin creates another Admin with empty scopes.
- Admin with non-empty scopes is rejected.
- New Scoped HR requires at least one country and one department in the creation workflow.
- Duplicate email is rejected without case sensitivity.
- Temporary password meets the approved length and randomness requirements.
- Only a password hash is stored.
- Temporary password appears only in the successful creation response.
- Temporary password does not enter logs or audit history.
- Duplicate create request with the same idempotency key creates one user.

### Scope

- Country OR works inside the country list.
- Department OR works inside the department list.
- Country and department use AND across dimensions.
- Scope preview returns the exact cross-product and accessible employee count.
- Replacing both scope dimensions commits atomically.
- Empty stored scope grants no employee access.
- Scope change affects the next authenticated request.
- Scope change does not require session reissue.
- Invalid country or department is rejected.

### Role

- Scoped HR can be promoted to Admin.
- Promotion removes all scope rows.
- Promotion revokes existing sessions.
- Admin-to-Scoped demotion is rejected.
- Admin scope assignment is rejected.

### Activation and deactivation

- Deactivation revokes every active session in the same transaction.
- Deactivated user fails on the next request.
- Reactivation restores role and scopes but not sessions.
- Last active Admin cannot be deactivated.
- Self-deactivation succeeds when another active Admin exists.
- Concurrent Admin deactivations leave one active Admin.
- Deactivation and reactivation require reason notes.

### Concurrency and idempotency

- Every target update requires expected version.
- A stale expected version returns HTTP 409.
- Stale update changes no user, scope, session, version, or audit row.
- Same idempotency key and same command return the original result.
- Same idempotency key with different data returns conflict.
- Two concurrent scope changes produce one success and one stale conflict.

### Audit

- User creation writes one audit event.
- Scope change stores exact before and after state.
- Promotion stores role and removed scopes.
- Deactivation and reactivation store reason and state.
- No-change request writes nothing.
- Audit events cannot be updated or deleted through application operations.
- Audit failure rolls back user, scope, role, status, session, and version changes.
- Audit does not contain password, hash, JWT, cookie, session ID, or authorization data.
- Scoped HR cannot read audit events.

### API

- Runtime schemas reject unknown and malformed fields.
- List search, filters, sorting, and pagination are allowlisted.
- Responses contain no password hash or session data.
- OpenAPI matches runtime behavior.
- Logs contain no request body, password, token, or sensitive audit state.

### Frontend and browser

- Admin lists, searches, filters, and opens HR users.
- Admin creates Scoped HR and sees the temporary password once.
- Admin previews and applies a scope change.
- Resulting employee count matches the preview.
- Admin promotes Scoped HR and the UI shows all-employee access.
- Admin deactivates and reactivates an HR user.
- Last-Admin protection displays the correct message.
- Stale edit shows current and proposed values without auto-confirming.
- Audit timeline shows actor, old state, new state, reason, and time.
- Scoped HR cannot open the HR Access page.
- Desktop and mobile workflows have no page-level overflow.
- Keyboard users can create, preview, confirm, filter, and inspect audit history.
- Automated accessibility scan has no serious or critical findings.

## Deliberately excluded

- Enterprise single sign-on.
- Password reset email.
- Email delivery service.
- Forced first-login password change.
- Multi-factor authentication.
- Admin-to-Scoped demotion.
- Custom roles.
- Per-employee access grants.
- Paired country-department scopes.
- Permission approval workflow.
- Audit deletion UI.

## Open questions

- None for the first HR access-management version.
