# Workbook database seed design

**Status:** Approved design. Implementation waits for Task 02 acceptance.

## Goal

Load the generated ACME workbook into MySQL.

The seed operation replaces all employee and compensation data. It is only for development, test, and synthetic demo environments.

The seed operation is not the later HR spreadsheet import feature.

## Input

Default workbook:

```text
express-backend/generated/acme-employees.xlsx
```

The command can accept another `.xlsx` path.

The workbook must match `docs/01-source-workbook.md` and `docs/02-synthetic-data-rules.md`.

## Required safeguards

The command must require:

```text
--replace
```

It must also require one of:

```text
APP_ENV=development
APP_ENV=test
APP_ENV=demo
```

It must refuse:

```text
APP_ENV=production
```

It must refuse a missing or unknown `APP_ENV` value.

It must use `process.env.DATABASE_URL`. It must not read an `.env` file.

The command must validate its environment, arguments, workbook structure, and all workbook rows before it starts a database transaction.

## Workbook parsing

The parser must:

- Open one `.xlsx` workbook.
- Require one worksheet named `Employees`.
- Require the approved 16 headers in the approved order.
- Reject missing, repeated, or unexpected headers.
- Reject formula cells.
- Reject an empty workbook.
- Read exactly 10,000 employee rows for the approved seed file.
- Preserve employee IDs, email addresses, enum text, and ISO date text.
- Convert salary and bonus values to exact decimal strings before database insertion.
- Use the existing employee and complete-data validators.

Do not trust Excel display formatting as validation.

## Reference data

Insert or verify the approved countries, departments, and job titles before employee insertion.

The reference data comes from approved application constants. It does not come from arbitrary workbook values.

Do not delete reference data during the employee replacement operation.

Resolve each workbook department, job title, and level to one `job_titles.id`.

Stop before the transaction if any workbook value cannot resolve to the approved reference data.

## Replacement transaction

Use one MySQL connection for the complete replacement transaction.

Inside the transaction:

1. Delete all rows from `compensation_records`.
2. Delete all rows from `employees`.
3. Insert all 10,000 employees.
4. Resolve the new internal employee IDs by stable employee code.
5. Insert one compensation record for each employee.
6. Verify that `employees` contains 10,000 rows.
7. Verify that `compensation_records` contains 10,000 rows.
8. Commit.

Each initial compensation row uses:

```text
version = 1
change_reason = INITIAL_IMPORT
effective_from = salary_effective_date
```

Use `DELETE`. Do not use `TRUNCATE` because MySQL can commit `TRUNCATE` outside the intended transaction behavior.

If any delete, insert, or count check fails, roll back the transaction. The previous employee and compensation data must remain available.

## Insert method

Use parameterized batch inserts.

Do not build SQL by joining workbook values into SQL text.

Use a bounded batch size. Record the selected batch size and reason in the builder response.

Do not insert one row per network round trip unless measurement proves that this is acceptable.

## Stable and internal identifiers

`employee_code` is the stable business identifier.

The seed operation does not reset auto-increment values. Internal employee and compensation IDs can change after another replacement.

Application behavior and tests must not depend on fixed internal IDs.

## Output

On success, print a short summary:

```text
Seeded 10000 employees and 10000 compensation records.
```

Do not print employee rows, salaries, database credentials, or the complete database URL.

On failure, print a short reason and return a non-zero exit code.

## Example

```bash
APP_ENV=development \
DATABASE_URL="mysql://..." \
npm run db:seed -- --replace
```

The user supplies the environment values. The application does not load them from a file.

## Scope limits

This seed operation does not:

- Update selected employees.
- Preview spreadsheet changes.
- Produce row-level error downloads.
- Preserve existing employee or compensation rows.
- Import historical salary versions.
- Create HR users or access scopes.
- Run in a production environment.

Those behaviors belong to later application features.
