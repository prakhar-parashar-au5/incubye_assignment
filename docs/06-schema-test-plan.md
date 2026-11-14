# Initial schema test plan

**Status:** Approved before SQL implementation

## Goal

The tests must prove that MySQL enforces the important structure and data rules in `docs/05-initial-database-schema.md`.

Use a real MySQL 8 test database. Do not replace database tests with mocks.

## Migration runner tests

- Apply pending SQL migration files in file-name order.
- Record each applied migration in `schema_migrations`.
- Do not apply an already recorded migration again.
- Stop when a migration fails.
- Do not record a failed migration as applied.
- Reject a test run when the database name does not end with `_test`.

MySQL can commit data definition statements automatically. Do not claim that the complete schema migration is transactional. Use forward-only migrations.

## Table tests

Confirm that the migration creates:

- `countries`
- `departments`
- `job_titles`
- `employees`
- `compensation_records`
- `schema_migrations`

Confirm the expected primary keys, unique constraints, foreign keys, and indexes.

## Reference data tests

- Insert India with INR.
- Insert the United States with USD.
- Reject a duplicate country code.
- Reject a duplicate country name.
- Reject a duplicate department name.
- Reject a job title for a missing department.
- Reject a duplicate department, title, and level combination.
- Reject unsupported enum values.

## Employee constraint tests

- Accept a valid employee.
- Reject a duplicate employee code.
- Reject a duplicate email address.
- Reject an employee code that does not match `ACME` plus five digits.
- Reject an unknown country.
- Reject an unknown job title.
- Reject an unsupported employment status.
- Reject a `LEFT` employee without an employment end date.
- Reject a `CURRENTLY_WORKING` employee with an employment end date.
- Reject a `SOON_TO_JOIN` employee with an employment end date.
- Reject an employment end date that is not after the hire date.
- Start employee version at `1`.

The application will validate whether dates are before or after the fixed generation date. The database does not use the computer date in a check constraint.

## Compensation constraint tests

- Accept compensation version `1` for a valid employee.
- Reject compensation for an unknown employee.
- Reject zero or negative annual base salary.
- Reject a negative annual bonus.
- Reject more than two decimal places before insert. MySQL `DECIMAL` can round input, so application validation is also required.
- Reject an unsupported currency, pay frequency, or change reason.
- Reject a duplicate employee and version pair.
- Allow two versions with the same effective date.
- Confirm that the higher version wins when both records have the same effective date.
- Confirm that a future record does not become current for an earlier as-of date.
- Prevent deletion of an employee who has compensation records.
- Prevent deletion of referenced country, department, and job-title rows.

## Money tests

Read salary and bonus values as exact decimal strings through `mysql2`.

Use a value such as:

```text
1000000.10
```

Confirm that the database result is not converted to a JavaScript floating-point number.

## Isolation and cleanup

- Use a dedicated database whose name ends with `_test`.
- Reset the test database before the schema suite.
- Do not connect to a deployed or production database.
- Do not read `.env` files.
- Use injected process environment values only.
- Keep test data small and hand-written.
- Close the MySQL connection pool after the suite.

## Test quality

Each test must state the defect it can detect. Use literal expected results. Do not reproduce the migration implementation inside the test.
