# express-backend

Current milestone: the deterministic source workbook generator only. There is no Express API, database, or migration yet.

The approved rules live in `../docs/01-source-workbook.md` and `../docs/02-synthetic-data-rules.md`.

## Commands

```sh
npm install
npm run lint
npm test
npm run generate:workbook                     # writes generated/acme-employees.xlsx
npm run generate:workbook -- --overwrite      # replace an existing file
npm run generate:workbook -- --output /tmp/a.xlsx --seed 7 --generation-date 2025-01-31
npm run generate:workbook -- --help
```

Defaults: seed `20261114`, generation date `2026-11-14`. The generator never uses the computer's date, the network, a database, or `.env` files. It refuses to replace an existing file unless `--overwrite` is given. Exit codes: `0` success, `1` existing output or invalid data, `2` invalid command input.

## Layout

| File | Concern |
|---|---|
| `src/source-workbook/constants.js` | Approved values, ranges, distributions, titles |
| `src/source-workbook/seeded-random.js` | Seeded random numbers (mulberry32) and shuffle |
| `src/source-workbook/iso-date.js` | `YYYY-MM-DD` checks and UTC day arithmetic |
| `src/source-workbook/names.js` | Fixed synthetic name lists |
| `src/source-workbook/employee-generator.js` | Generates the 10,000 employees |
| `src/source-workbook/employee-validator.js` | Rules for one employee |
| `src/source-workbook/employee-dataset.js` | Rules for the complete data set |
| `src/source-workbook/workbook-writer.js` | ExcelJS writing |
| `src/source-workbook/source-workbook.js` | Validate, then write through a temporary file |
| `src/source-workbook/cli-options.js` | Command-line parsing |
| `scripts/generate-workbook.js` | Thin command-line entry point |

## Generation choices not fixed by the approved documents

- `SOON_TO_JOIN` hire dates are 1–90 days after the generation date.
- Salaries are whole currency units, rounded to 100.
- Non-zero bonuses use a percentage of at least 0.01%, so exactly 2,000 employees (20%) have a zero bonus. The bonus is rounded down to two decimal places, then capped.
- A "management title" is a title approved for the `MANAGER` level. `Program Manager` is an approved `SENIOR` Operations title, so it is allowed for `SENIOR`.
- Email name parts keep only the letters `a`–`z` after accents are removed, so `Mary Ann O'Brien` becomes `maryann.obrien.<id>@acme.com`.

## Known limitations

- Same seed and date give the same logical data. File bytes can differ (ZIP metadata), so tests compare logical data.
- ExcelJS 4.4.0 was last released in October 2023. `npm audit` reports a moderate advisory in its `uuid` dependency (buffer bounds in v3/v5/v6 when a buffer is passed). The generator does not call those functions.
- Validation lists cover the six fixed-value columns. `job_title` has no list because its allowed values depend on department and level.
