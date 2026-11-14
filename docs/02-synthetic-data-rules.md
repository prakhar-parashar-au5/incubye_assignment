# Synthetic employee data rules

**Status:** Approved  
**Employee count:** 10,000  
**Random seed:** `20261114`  
**Generation date:** `2026-11-14`

## Purpose

These rules define the synthetic employees in the source workbook.

The data supports product development, tests, analytics, and the demonstration. It is not market salary data.

The same seed and generation date must produce the same logical employee data.

## Exact distributions

### Country

| Country | Currency | Employees | Percentage |
|---|---|---:|---:|
| India | `INR` | 7,000 | 70% |
| United States | `USD` | 3,000 | 30% |

### Employment status

| Status | Employees | Percentage |
|---|---:|---:|
| `CURRENTLY_WORKING` | 8,500 | 85% |
| `LEFT` | 1,000 | 10% |
| `SOON_TO_JOIN` | 500 | 5% |

### Department

| Department | Employees | Percentage |
|---|---:|---:|
| `Tech` | 4,000 | 40% |
| `Support` | 2,500 | 25% |
| `Operations` | 2,000 | 20% |
| `Finance` | 800 | 8% |
| `HR` | 700 | 7% |

### Level

| Level | Employees | Percentage |
|---|---:|---:|
| `JUNIOR` | 2,500 | 25% |
| `MID` | 3,500 | 35% |
| `SENIOR` | 2,500 | 25% |
| `LEAD` | 800 | 8% |
| `MANAGER` | 700 | 7% |

The generator must meet each total exactly. It can shuffle assignments with the seeded random generator.

Country, department, level, and status are separate selections. Each department must contain employees from both countries.

## Pay frequency

| Country | Pay frequency |
|---|---|
| India | `MONTHLY` |
| United States | `ANNUAL` |

`annual_base_salary` remains the authoritative salary for both frequencies.

## Annual base salary ranges

### India

| Level | Minimum INR | Maximum INR |
|---|---:|---:|
| `JUNIOR` | 500,000 | 1,200,000 |
| `MID` | 1,000,000 | 2,200,000 |
| `SENIOR` | 1,800,000 | 3,800,000 |
| `LEAD` | 3,000,000 | 5,500,000 |
| `MANAGER` | 3,500,000 | 7,000,000 |

### United States

| Level | Minimum USD | Maximum USD |
|---|---:|---:|
| `JUNIOR` | 55,000 | 90,000 |
| `MID` | 80,000 | 130,000 |
| `SENIOR` | 120,000 | 190,000 |
| `LEAD` | 160,000 | 230,000 |
| `MANAGER` | 150,000 | 250,000 |

The ranges overlap by design. The data does not claim that level alone determines compensation.

## Annual bonus

Give exactly 20% of employees a zero annual bonus.

For all other employees, select a bonus percentage within the level range:

| Level | Minimum | Maximum |
|---|---:|---:|
| `JUNIOR` | 0% | 10% |
| `MID` | 0% | 15% |
| `SENIOR` | 0% | 20% |
| `LEAD` | 5% | 25% |
| `MANAGER` | 10% | 30% |

Apply these maximum bonus amounts:

| Group | INR maximum | USD maximum |
|---|---:|---:|
| `JUNIOR` | 200,000 | 2,000 |
| All other levels | 1,000,000 | 10,000 |

The selected bonus is the smaller of the percentage result and the currency cap.

## Job titles

### Tech

| Level | Allowed titles |
|---|---|
| `JUNIOR` | Junior Software Engineer, Junior Quality Engineer |
| `MID` | Software Engineer, Quality Engineer, Data Engineer, Platform Engineer |
| `SENIOR` | Senior Software Engineer, Senior Quality Engineer, Senior Data Engineer, Senior Platform Engineer |
| `LEAD` | Tech Lead, Quality Lead, Data Lead, Platform Lead |
| `MANAGER` | Engineering Manager |

### Support

| Level | Allowed titles |
|---|---|
| `JUNIOR` | Support Associate |
| `MID` | Support Specialist |
| `SENIOR` | Senior Support Specialist, Technical Support Engineer |
| `LEAD` | Support Lead |
| `MANAGER` | Support Manager |

### Operations

| Level | Allowed titles |
|---|---|
| `JUNIOR` | Operations Associate |
| `MID` | Operations Analyst |
| `SENIOR` | Senior Operations Analyst, Program Manager |
| `LEAD` | Operations Lead, Program Lead |
| `MANAGER` | Operations Manager |

### Finance

| Level | Allowed titles |
|---|---|
| `JUNIOR` | Finance Associate |
| `MID` | Accountant, Financial Analyst |
| `SENIOR` | Senior Accountant, Senior Financial Analyst |
| `LEAD` | Finance Lead |
| `MANAGER` | Finance Manager |

### HR

| Level | Allowed titles |
|---|---|
| `JUNIOR` | HR Associate |
| `MID` | Recruiter, HR Generalist |
| `SENIOR` | Senior Recruiter, HR Business Partner, Compensation Analyst |
| `LEAD` | HR Lead, Recruitment Lead |
| `MANAGER` | HR Manager |

A `MANAGER` employee must have a management title. A non-manager employee must not have a management title.

## Employment dates

Generate dates from 2012 through the fixed generation date.

- `SOON_TO_JOIN` employees have a future hire date and no end date.
- `CURRENTLY_WORKING` employees have a past or current hire date and no end date.
- `LEFT` employees have a hire date before their end date.
- A `LEFT` employee has an end date on or before the generation date.
- Salary effective date is not before hire date.
- Salary effective date is not after the end date for a `LEFT` employee.
- Salary effective date equals hire date for a `SOON_TO_JOIN` employee.

## Identity data

- Employee IDs run from `ACME00001` through `ACME10000`.
- First and last names come from fixed source lists.
- Each email address is lowercase.
- Each email address contains the employee ID.
- Each email address uses the `acme.com` domain.

Example:

```text
aditi.sharma.acme00001@acme.com
```

Names can repeat. Employee IDs and email addresses cannot repeat.

## Data quality rules

Before workbook creation, the generator must check:

- Total row count.
- All exact distribution totals.
- Unique employee IDs.
- Unique email addresses.
- Valid department and job title pairs.
- Valid level and title pairs.
- Valid country and currency pairs.
- Valid country and pay frequency pairs.
- Valid employment date rules.
- Valid salary ranges.
- Valid bonus percentages and caps.

The generator must stop if a check fails. It must not create a workbook with invalid data.
