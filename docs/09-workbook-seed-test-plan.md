# Workbook database seed test plan

**Status:** Approved before seed implementation

## Goal

Prove that the seed command replaces employee and compensation data safely and exactly.

Use a real MySQL 8 test database. Do not mock database transactions.

## Safety tests

- Refuse to run without `--replace`.
- Refuse `APP_ENV=production`.
- Refuse a missing or unknown `APP_ENV`.
- Accept `development`, `test`, and `demo`.
- Refuse a missing database URL.
- Do not read `.env` files.
- Do not log the database URL, employee salary, or full employee rows.

The destructive integration suite must refuse a database whose name does not end with `_test`.

## Workbook parser tests

- Accept the approved generated workbook.
- Reject a missing `Employees` worksheet.
- Reject a missing header.
- Reject an unexpected header.
- Reject repeated headers.
- Reject headers in the wrong order.
- Reject a formula cell.
- Reject an empty workbook.
- Reject an invalid employee row by using the existing validator.
- Read salary and bonus as exact two-decimal strings for database insertion.

Use small temporary workbooks for parser error tests. Use the approved 10,000-row workbook for one full seed integration test.

## Reference data tests

- Create or verify the two approved countries.
- Create or verify all approved departments.
- Create or verify all approved job-title, department, and level combinations.
- Resolve every workbook title to one job-title ID.
- Reject an unresolved workbook title before employee deletion starts.
- Running reference-data setup again does not create duplicates.

## Successful seed test

After a successful seed, confirm:

- `employees` contains exactly 10,000 rows.
- `compensation_records` contains exactly 10,000 rows.
- Every employee code is unique.
- Every email address is unique.
- Every employee has one compensation record.
- Every compensation record has version `1`.
- Every compensation record has reason `INITIAL_IMPORT`.
- Salary and bonus values match selected workbook rows exactly.
- Department, job title, level, country, currency, status, and dates match selected workbook rows.
- Country, department, level, and status totals match the approved distributions.

Do not assert fixed internal database IDs.

## Replacement test

1. Seed the database.
2. Add a clear test-only employee and compensation row.
3. Run the seed again with `--replace`.
4. Confirm that the test-only employee is gone.
5. Confirm that there are still exactly 10,000 employees and 10,000 compensation records.
6. Confirm that stable employee codes contain the approved logical data.

The test proves replacement instead of accidental append or upsert behavior.

## Rollback test

Create a database-side test condition that causes an insert to fail after deletion starts.

Run the seed operation.

Confirm that:

- The operation returns a failure.
- The previous employee rows still exist.
- The previous compensation rows still exist.
- No partial replacement rows remain.

Remove the test-only failure condition during cleanup.

The test must exercise a failure inside the transaction. A workbook validation failure before the transaction is not sufficient for this test.

## Repeat and performance tests

- Run the seed twice with `--replace`.
- Confirm that row counts do not increase to 20,000.
- Record the local MySQL version, machine conditions, batch size, total seed time, and row counts.
- Do not state a production performance guarantee from one local run.

## Regression tests

Run the existing workbook generator tests after seed implementation.

The seed work must not change approved workbook generation behavior.

## Test quality

- Use literal expected counts.
- Use selected literal workbook values for exact mapping checks.
- Use a real MySQL transaction.
- Keep parser fixtures small.
- Do not use network services other than local MySQL.
- Explain the defect that each important test detects.
