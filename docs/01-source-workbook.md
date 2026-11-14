# Source workbook design

**Status:** Approved  
**File type:** `.xlsx`  
**Worksheet name:** `Employees`

## Purpose

The workbook is the source file for the first employee import. It contains employee details and current compensation for 10,000 synthetic ACME employees.

The workbook also acts as a sample import file for the product demonstration.

## Row meaning

One row represents one employee and the employee's current compensation.

The workbook does not contain compensation history. The application starts compensation history when it imports the workbook.

## Columns

| Column | Required | Example | Rule |
|---|---:|---|---|
| `employee_id` | Yes | `ACME00001` | Unique. Format is `ACME` followed by five digits. |
| `first_name` | Yes | `Aditi` | Must not be empty. |
| `last_name` | Yes | `Sharma` | Must not be empty. |
| `email` | Yes | `aditi.sharma.acme00001@acme.com` | Unique ACME email address. |
| `department` | Yes | `Tech` | Must be an allowed department. |
| `job_title` | Yes | `Senior Software Engineer` | Must be valid for the department. |
| `level` | Yes | `SENIOR` | Must be an allowed level. |
| `country_code` | Yes | `IN` | Must be `IN` or `US`. |
| `currency` | Yes | `INR` | Must match the country. |
| `employment_status` | Yes | `CURRENTLY_WORKING` | Must be an allowed status. |
| `hire_date` | Yes | `2022-08-14` | ISO date in `YYYY-MM-DD` format. |
| `employment_end_date` | Conditional | `2025-01-31` | Required only when status is `LEFT`. |
| `annual_base_salary` | Yes | `2500000.00` | Positive annual base salary. Maximum two decimal places. |
| `pay_frequency` | Yes | `MONTHLY` | Must be `MONTHLY` or `ANNUAL`. |
| `annual_bonus` | Yes | `150000.00` | Current annual cash bonus target. Zero or positive. |
| `salary_effective_date` | Yes | `2025-04-01` | Date when the current annual base salary became effective. |

The worksheet contains one header row and exactly 10,000 employee rows.

## Allowed values

### Departments

- `Tech`
- `HR`
- `Finance`
- `Operations`
- `Support`

### Levels

- `JUNIOR`
- `MID`
- `SENIOR`
- `LEAD`
- `MANAGER`

### Countries and currencies

| Country | `country_code` | Required currency |
|---|---|---|
| India | `IN` | `INR` |
| United States | `US` | `USD` |

The workbook does not convert money between currencies.

### Employment statuses

- `SOON_TO_JOIN`
- `CURRENTLY_WORKING`
- `LEFT`

### Pay frequencies

- `MONTHLY`
- `ANNUAL`

Pay frequency describes how often ACME pays the employee. It does not change the meaning of `annual_base_salary`.

## Validation rules

### Employee ID

- IDs start at `ACME00001`.
- IDs end at `ACME10000` for the 10,000-row workbook.
- Every ID is unique.
- IDs do not change when other employee details change.

### Email

- Email addresses use the `acme.com` domain.
- Email addresses use lowercase letters.
- The generator includes the employee ID to make each address unique.
- The generator normalizes spaces and unsupported name characters before it creates the address.

Example:

```text
aditi.sharma.acme00001@acme.com
```

### Employment dates

`SOON_TO_JOIN`:

- `hire_date` is after the workbook generation date.
- `employment_end_date` is empty.
- `salary_effective_date` is the hire date.

`CURRENTLY_WORKING`:

- `hire_date` is on or before the workbook generation date.
- `employment_end_date` is empty.
- `salary_effective_date` is on or after the hire date.
- `salary_effective_date` is on or before the workbook generation date.

`LEFT`:

- `hire_date` is before `employment_end_date`.
- `employment_end_date` is on or before the workbook generation date.
- `salary_effective_date` is on or after the hire date.
- `salary_effective_date` is on or before `employment_end_date`.

The generator uses a fixed generation date. It does not use the computer's current date. This rule keeps output repeatable.

### Compensation

- `annual_base_salary` is the authoritative base salary.
- The workbook does not contain a monthly salary column.
- A monthly equivalent is a derived display value. It is not authoritative compensation.
- `annual_base_salary` must be more than zero.
- `annual_base_salary` can have a maximum of two decimal places.
- `annual_bonus` can be zero.
- `annual_bonus` uses the employee's salary currency.
- `annual_bonus` is a target. It is not a payment record.
- A `JUNIOR` employee has a maximum annual bonus of INR 200,000 or USD 2,000.
- All other levels have a maximum annual bonus of INR 1,000,000 or USD 10,000.

The workbook does not contain annual cash compensation. The application calculates it as:

```text
annual cash compensation = annual base salary + annual bonus
```

The application never adds INR and USD amounts together.

## Workbook presentation

The generated workbook must:

- Use one `Employees` worksheet.
- Freeze the header row.
- Enable filters on all columns.
- Use readable column widths.
- Use `YYYY-MM-DD` text for dates to avoid locale-dependent date conversion.
- Use numeric cells with a two-decimal display format for salary and bonus.
- Use Excel validation lists for controlled values where the library supports them.
- Contain no formulas, macros, external links, or secrets.

## Generation requirements

The generator must:

- Produce exactly 10,000 employee rows.
- Accept a fixed random seed.
- Accept a fixed generation date.
- Produce the same logical data for the same seed and generation date.
- Produce varied departments, roles, levels, countries, statuses, salaries, and bonuses.
- Keep job titles and compensation plausible for their department, level, country, and currency.
- Validate all rows before it writes the workbook.
- Stop with a clear error if generated data violates a rule.

## Known limitations

- The workbook contains current compensation only.
- It cannot reconstruct compensation changes from before the import.
- `annual_bonus` is a target, not an amount already paid.
- Pay frequency does not model payroll dates, deductions, taxes, or bank payments.
- The data is synthetic. It is not suitable for payroll or market benchmarking.
