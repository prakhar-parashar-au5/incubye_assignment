# Salary adjustment specification

## User and problem

Admin HR can directly adjust compensation for an eligible employee.

Scoped HR can only create a salary change request for an employee inside their current country and department scope. An Admin HR must approve or cancel that request.

Preview and confirmation are required. No user can change compensation with one unreviewed click.

## Role behavior

### Admin HR

Admin HR can:

- Preview an adjustment for any eligible employee.
- Apply the exact previewed adjustment directly.
- View all salary change requests.
- Approve or cancel pending requests.

An Admin direct change does not create a change request.

### Scoped HR

Scoped HR can:

- Preview an adjustment only for an employee inside their current scope.
- Submit the exact previewed adjustment as a request.
- View requests for employees inside their current scope.

Scoped HR cannot directly change compensation. Scoped HR cannot approve or cancel a request, including their own request.

## Main journey

### Admin direct change

1. Find an employee.
2. Select Adjust compensation.
3. Select adjustment target and method.
4. Enter the value, effective date, reason, and note when required.
5. Select Preview.
6. Review old value, new value, change, annual cash impact, and effective date.
7. Select Apply salary change or Cancel.
8. See success or a clear error.
9. See the new compensation version in history.

### Scoped HR request

1. Find an employee inside the current scope.
2. Select Request compensation change.
3. Enter the adjustment.
4. Preview the exact result.
5. Select Submit for approval.
6. See acknowledgement and request status.
7. Track the request in the request list.

### Admin approval

1. Open the approval queue.
2. Review the requester, employee, current compensation, requested result, reason, and effective date.
3. Approve the exact request or cancel it with a reason.
4. Approval creates the new compensation version.
5. Cancellation does not change compensation.

Admin HR cannot edit a request before approval. Admin must approve the exact request or cancel it. The requester must create another request for changed values.

Any active Admin HR can approve or cancel a request.

## Eligible employees

- `CURRENTLY_WORKING`: eligible.
- `SOON_TO_JOIN`: eligible.
- `LEFT`: not eligible.

Message:

```text
This employee is not eligible for a compensation adjustment.
```

## Adjustment targets

One adjustment changes one target:

```text
BASE_SALARY
ANNUAL_BONUS
```

A base-salary adjustment keeps annual bonus unchanged.

A bonus adjustment keeps annual base salary unchanged.

Pay frequency and currency remain unchanged.

Annual base salary remains authoritative.

## Adjustment methods

Support:

- Percentage increase.
- Percentage decrease.
- Fixed amount increase.
- Fixed amount decrease.
- Replacement amount.

Percentage limits:

```text
Increase: integer from 1% to 200%
Decrease: integer from 1% to 50%
```

Percentage values have no decimal places.

Fixed and replacement amounts can have at most two decimal places.

A bonus percentage adjustment requires a current bonus greater than zero. A zero bonus can be changed with a fixed increase or replacement amount.

No adjustment can produce a negative value. Base salary must remain greater than zero. Annual bonus can be zero.

A no-change result is invalid.

## Salary bands

Create a separate `salary_bands` table.

A band belongs to:

```text
job_title_id
country_code
currency
```

Store:

- Minimum annual base salary.
- Maximum annual base salary.
- Maximum annual bonus.
- Minimum percentage increase.
- Maximum percentage increase.
- Minimum percentage decrease.
- Maximum percentage decrease.
- Created time.
- Updated time.

The initial ACME bands use the approved synthetic salary ranges and bonus caps. This is now a product-policy decision, not only a generator rule.

The backend enforces salary bands. The frontend uses the same published limits for early feedback.

A request or direct change outside the band is rejected.

## Money and rounding

Amounts have at most two decimal places.

Use exact decimal or integer minor-unit arithmetic. Do not use JavaScript floating-point arithmetic for authoritative compensation.

Percentage calculations use half-up rounding to two decimal places. If the third decimal digit is 5 or more, round the second decimal digit up.

Round once, after calculating the exact adjustment result.

## Effective date

The effective date can be today or in the future.

Past effective dates are not supported in this version.

The organization-wide UTC business date applies.

An employee can have only one approved future compensation change at a time.

An approved future replacement is an absolute amount. An immediate change does not silently delete or recalculate it. Preview must warn that the scheduled amount will still take effect on its effective date.

Cancelling or editing an already approved future compensation record is not part of this version.

A pending salary change request can be cancelled by Admin HR.

## Reasons and notes

Allowed reasons:

- Performance.
- Market adjustment.
- Promotion.
- Role change.
- Correction.

A reason is always required.

A note is required for:

- Correction.
- Request cancellation.

The note is optional for other reasons.

Maximum note length is 2,000 characters.

The note must not contain passwords, tokens, health information, bank information, or other unnecessary sensitive data.

## Preview

Preview writes nothing to the database.

Preview shows:

- Employee.
- Adjustment target.
- Current annual base salary.
- Current annual bonus.
- Adjustment method and input.
- New annual base salary.
- New annual bonus.
- Absolute change.
- Percentage change.
- Current annual cash compensation.
- New annual cash compensation.
- Annual budget impact.
- Native currency.
- Effective date.
- Reason and note.
- Current compensation version.
- Salary band and validation result.
- Warning for an existing approved future change.

The preview response includes:

```text
confirmationMode = DIRECT_APPLY
```

for Admin HR, and:

```text
confirmationMode = SUBMIT_REQUEST
```

for Scoped HR.

The frontend uses this value to show either:

```text
Apply salary change
```

or:

```text
Submit for approval
```

## Preview token

A preview is valid for five minutes.

The backend returns a signed preview token that binds:

- HR actor.
- Employee.
- Adjustment target.
- Method and value.
- Exact proposed result.
- Effective date.
- Reason and note.
- Expected compensation version.
- Confirmation mode.
- Expiry time.

Confirmation sends the token. The backend verifies it and recalculates the result.

The browser cannot change a preview value after the token is signed.

## Compensation version and row lock

The highest `compensation_records.version` protects salary operations.

The preview returns:

```text
expectedCompensationVersion
```

Request submission, Admin direct apply, and request approval use this version.

`employees.version` protects employee profile changes. It does not protect compensation changes.

The transaction locks the employee row with:

```sql
SELECT ... FROM employees WHERE id = ? FOR UPDATE
```

After obtaining the lock, it reads the latest compensation version again.

The employee row is the stable serialization lock for every compensation operation on that employee.

## Stale conflicts

If expected compensation version does not match the latest version:

1. Return HTTP 409.
2. Do not write compensation.
3. Do not approve the request.
4. Frontend requests and displays a fresh preview.
5. HR must confirm the fresh preview again.

The frontend never confirms the changed result automatically.

## Change request states

Use:

```text
PENDING
APPROVED
CANCELLED
STALE
```

- `PENDING`: waiting for Admin action.
- `APPROVED`: Admin applied the exact change.
- `CANCELLED`: Admin intentionally declined it with a note.
- `STALE`: system state changed and the request can no longer be applied.

Do not use separate `REJECTED` or `DECLINED` database statuses.

Only one pending request is allowed for one employee at a time.

After an Admin direct change or approved request creates a new compensation version, all other pending requests against an older compensation version become `STALE`.

Stale reason:

```text
Compensation changed after this request was created.
```

## Approval revalidation

Before approval, the backend rechecks:

- Request is pending.
- Requester still exists.
- Requester is active.
- Employee remains inside the requester's current scope.
- Employee remains eligible.
- Salary band still permits the result.
- Preview or request data is valid.
- Compensation version is unchanged.
- Effective date remains valid.
- No conflicting approved future change exists.

A failed recheck marks the request `STALE` when the failure is caused by changed system state.

## Idempotency

Require an idempotency key for:

- Scoped HR request creation.
- Admin direct adjustment.
- Admin approval.
- Admin cancellation.

The same key with the same command returns the original result.

The same key with different data returns a conflict.

Idempotency protects retries of one operation. It does not protect different concurrent operations.

Employee row locking and expected compensation version protect different concurrent operations.

## Database records

Use one new workflow table:

```text
compensation_change_requests
```

Do not create a separate compensation audit table.

`compensation_change_requests` stores:

- Request ID.
- Employee ID.
- Requested by HR user.
- Adjustment target.
- Adjustment method.
- Input value.
- Previous target value.
- Proposed target value.
- Requested against compensation version.
- Effective date.
- Reason.
- Note.
- Status.
- Decided by HR user.
- Decided time.
- Decision note or stale reason.
- Request idempotency key.
- Approval or cancellation idempotency key.
- Created time.
- Updated time.

`compensation_records` remains the immutable compensation history.

Add these fields to compensation records if they do not exist:

- Previous compensation record ID.
- Changed by HR user ID.
- Source request ID, nullable for Admin direct changes.
- Change note.
- Operation idempotency key.

For an approved request, `changed_by_hr_user_id` is the Admin who approved it. The request row preserves the Scoped HR requester.

Direct Admin change, approved request, compensation record, request status, and stale status changes must use one transaction where they belong to the same operation.

## Request visibility

Admin HR can view all requests.

Scoped HR can view requests for employees inside their current scope, including requests created by another Scoped HR user.

Request results show:

- Employee.
- Requester.
- Requested and proposed values.
- Status.
- Effective date.
- Reason.
- Created time.
- Admin who approved or cancelled it.
- Decision time.
- Cancellation or stale reason.

## API behavior

Preview:

```text
POST /api/v1/employees/:employeeCode/salary-adjustments/preview
```

Admin direct apply:

```text
POST /api/v1/employees/:employeeCode/salary-adjustments
```

Requests:

```text
POST /api/v1/employees/:employeeCode/salary-adjustment-requests
GET  /api/v1/salary-adjustment-requests
GET  /api/v1/salary-adjustment-requests/:requestId
POST /api/v1/salary-adjustment-requests/:requestId/approve
POST /api/v1/salary-adjustment-requests/:requestId/cancel
```

Admin queue supports:

- Request-created date sorting, ascending or descending.
- Employee name.
- Employee ID.
- Employee email.
- Department.
- Request status.

Scoped HR list supports:

- Request-created date sorting, ascending or descending.
- Employee name.
- Employee ID.
- Employee email.
- Request status.

Public errors:

```text
400 VALIDATION_ERROR
403 FORBIDDEN
404 NOT_FOUND
409 STALE_VERSION
409 DUPLICATE_OPERATION
409 PENDING_REQUEST_EXISTS
409 REQUEST_NOT_PENDING
422 EMPLOYEE_INELIGIBLE
503 SERVICE_UNAVAILABLE
```

HTTP 402 is not used. It means Payment Required.

Unknown and out-of-scope employees use the same 404 response.

## Page states

Support:

- Loading employee.
- Invalid adjustment.
- Preview ready.
- Preview expired.
- Confirming direct change.
- Submitting request.
- Request pending.
- Approval success.
- Cancellation success.
- Stale conflict with fresh preview.
- Employee not found.
- Employee ineligible.
- Salary-band violation.
- Existing future change.
- Existing pending request.
- Duplicate operation.
- Backend unavailable.

## Tests I expect

### Calculation and validation

- Percentage increase uses half-up rounding.
- Percentage decrease calculates the correct result.
- Fixed increase preserves two-decimal money.
- Fixed decrease cannot produce zero or negative base salary.
- Replacement cannot create a no-change result.
- Minimum and maximum percentage boundaries are accepted.
- Values outside percentage boundaries are rejected.
- Base salary adjustment does not change annual bonus.
- Bonus adjustment does not change annual base salary.
- Zero bonus supports fixed increase and replacement but not a no-op percentage change.
- Backend rejects a result outside the salary band.
- Frontend salary-band validation does not replace backend validation.

### Preview

- Preview writes no compensation or request row.
- Preview returns exact old and new values.
- Admin preview returns `DIRECT_APPLY`.
- Scoped HR preview returns `SUBMIT_REQUEST`.
- Preview token rejects changed fields.
- Preview token expires after five minutes.
- Preview token belongs to the authenticated HR actor.

### Admin direct changes

- Admin direct change creates one immutable compensation version.
- Direct base change keeps bonus unchanged.
- Direct bonus change keeps base salary unchanged.
- Compensation and request-stale updates roll back together after failure.
- Duplicate direct confirmation creates one compensation version.

### Scoped HR requests

- Scoped HR request creates one pending request and no compensation record.
- Scoped HR cannot request an out-of-scope employee.
- Duplicate request submission creates one request.
- A second pending request for the same employee is rejected.
- Scoped HR cannot approve or cancel any request.
- Scoped HR can view requests for employees in their current scope.
- Scoped HR cannot view requests outside their current scope.

### Approval and cancellation

- Admin approval creates the exact requested compensation version.
- Approval and request status commit in one transaction.
- Compensation insert failure leaves the request pending.
- Request-status update failure rolls back compensation insertion.
- Admin cancellation changes no compensation.
- Cancellation requires a decision note.
- Repeated approval returns the original result and creates one compensation version.
- Repeated cancellation returns the original result.
- Two Admin users approving one request produce one success and one conflict.

### Stale and concurrent operations

- Two Admin direct changes against one version produce one success and one stale conflict.
- Admin direct change makes older pending requests stale.
- Approved request makes other pending requests stale.
- Stale request cannot be approved.
- Inactive requester makes a pending request stale at approval.
- Requester scope removal makes a pending request stale at approval.
- Employee changing to `LEFT` makes the request stale.
- Fresh preview after conflict requires another manual confirmation.

### Effective dates

- Today's change becomes current today.
- Future change does not become current early.
- Future change becomes current on its effective date.
- Past effective date is rejected.
- A second approved future change is rejected.
- Immediate change keeps the existing approved future absolute amount.
- Preview warns when an approved future change exists.

### API and permissions

- Missing authentication fails.
- Admin can directly change any eligible employee.
- Scoped HR direct-apply endpoint returns forbidden.
- Preview and request submission enforce scope.
- Approval rechecks requester status and scope.
- Unknown and out-of-scope employees return identical 404 bodies.
- Invalid inputs map to the approved public errors.
- Request list filters and sorting are allowlisted and parameterized.
- Responses contain no internal database IDs.
- Logs contain no salary values, notes, tokens, or request bodies.

### Browser journeys

- Admin previews and directly applies a salary change, then sees history.
- Scoped HR submits a request and sees Pending without salary changing.
- Admin reviews and approves the request.
- Scoped HR later sees Approved and the employee's new compensation.
- Admin cancels another request with a note and salary remains unchanged.
- Stale conflict displays a fresh preview but does not auto-confirm.
- Mobile and keyboard users can complete request and approval workflows.

## Deliberately excluded

- Bulk adjustments.
- Annual review cycles.
- More than one pending request per employee.
- Multi-stage approval.
- Pay-frequency change.
- Currency change.
- Past-effective correction.
- Editing a submitted request.
- Cancelling an approved future compensation record.
- Agent-executed mutation.
- Separate compensation audit table.
