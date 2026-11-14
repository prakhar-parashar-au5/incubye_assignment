# Workbook generator test plan

**Status:** Approved before generator implementation

## Purpose

These tests must find incorrect synthetic data before the generator writes the workbook.

The tests check three parts:

1. One generated employee.
2. The complete generated data set.
3. The final `.xlsx` workbook.

## Employee validation tests

- Reject a missing required value.
- Reject an empty required text value.
- Reject an employee ID that does not match `ACME` plus five digits.
- Reject an unsupported department, level, status, country, currency, or pay frequency.
- Reject a country and currency mismatch.
- Reject a country and pay frequency mismatch.
- Reject a job title that does not match the department and level.
- Reject an annual base salary outside the approved country and level range.
- Reject an annual base salary with more than two decimal places.
- Reject a negative annual bonus.
- Reject an annual bonus above the approved level and currency limit.
- Reject a salary effective date before the hire date.
- Reject a `SOON_TO_JOIN` employee with a past hire date or an end date.
- Reject a `CURRENTLY_WORKING` employee with a future hire date or an end date.
- Reject a `LEFT` employee without an end date.
- Reject a `LEFT` employee whose end date is not after the hire date.
- Reject a `LEFT` employee whose salary effective date is after the end date.

Use small hand-written employee records for these tests. Each test must change one relevant value.

## Complete data set tests

- Generate exactly 10,000 employees.
- Generate 10,000 unique employee IDs.
- Generate 10,000 unique email addresses.
- Generate IDs from `ACME00001` through `ACME10000`.
- Generate the same logical data for the same seed and generation date.
- Generate different logical data for a different seed.
- Generate exactly 7,000 India employees and 3,000 United States employees.
- Generate exactly 8,500 `CURRENTLY_WORKING`, 1,000 `LEFT`, and 500 `SOON_TO_JOIN` employees.
- Generate the approved exact department totals.
- Generate the approved exact level totals.
- Generate exactly 20% zero bonuses.
- Validate every generated employee with the same validator used before workbook output.
- Confirm that every department contains employees from India and the United States.

The deterministic test must compare stable logical data. It must not depend on file timestamps or ZIP metadata inside the `.xlsx` file.

## Workbook tests

Generate a workbook in a temporary test directory. Read it again with the workbook library.

Check that:

- The file is a valid `.xlsx` workbook.
- The workbook contains one worksheet named `Employees`.
- The worksheet contains one header row and 10,000 employee rows.
- The headers match the approved column names and order.
- The first row is frozen.
- Filters cover the complete data range.
- Salary and bonus cells are numeric cells.
- Salary and bonus cells use a two-decimal display format.
- Date values use `YYYY-MM-DD` text.
- The workbook contains no formula cells.
- A sample of controlled columns has the expected Excel validation lists when the selected library supports them.

## Error behavior

- Do not create the target workbook when data validation fails.
- Return a non-zero process exit code when command input is invalid.
- Show a short error message that does not contain secrets or full employee records.
- Do not overwrite an existing file unless the caller gives an explicit overwrite option.

## Test quality rules

- Do not recalculate expected values with the same function as the generator.
- Use literal expected totals from the approved data rules.
- Do not use the computer date.
- Do not use network access.
- Do not read `.env` files.
- Do not use production databases.
- Explain the defect that each test can detect.
