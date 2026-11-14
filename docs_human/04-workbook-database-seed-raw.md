
## what are we doing here

We have the excel with 10k dummy ACME employees. Next step is getting the same data into mysql.

This is just our seed script for local/dev/demo setup. Not the actual HR excel upload feature. That one comes later with preview, errors, confirmation and all of that.

## basic choices

- javascript for now
- mysql 8
- mysql2
- raw sql, no ORM
- workbook is the source

I prefer raw queries here because I want the schema and queries to be visible. Also this is small enough right now, ORM is not giving us much.

## what happens when seed runs

I chose replace all.

So when we seed again, old employees + compensation records are removed and the same 10k rows are added from excel again. We are not doing upsert in this script.

Since this can delete data it should be difficult to run by mistake.

Need both:

```text
--replace
APP_ENV=development/test/demo
```

If APP_ENV is production, missing, or some random value -> stop without touching DB.

## first validate excel

Nothing should be deleted before the whole excel is checked.

Things to check:

- sheet is Employees
- all 16 headers, same order
- exactly 10000 rows
- IDs and emails are unique
- enum values are valid
- department + job title + level match
- IN means INR + MONTHLY
- US means USD + ANNUAL
- status/date rules
- salary ranges and bonus limits
- no formulas

If any of this fails, return the error before starting the DB transaction.

## transaction flow

Inside one transaction:

1. delete compensation_records
2. delete employees
3. insert 10000 employees
4. fetch/map the new internal employee ids using employee_code
5. insert 10000 compensation records
6. check both counts
7. commit

If step 3/4/5/6 fails, rollback. Old employees and salaries should come back. We need a real integration test for this, not only mock test.

Use DELETE, not TRUNCATE. TRUNCATE can commit separately in mysql and then rollback will not save us.

## first compensation row

Every employee gets one row:

```text
version = 1
change_reason = INITIAL_IMPORT
effective_from = salary_effective_date in excel
```

No old salary history because source excel itself only contains latest salary.

## IDs

ACME00001 etc is the actual stable employee id.

The DB numeric id is internal. It can change after reseeding and nothing outside DB should depend on it.

No need to reset auto increment. It adds risk for no useful benefit.

## countries/departments/job titles

These are reference data. Insert them if missing or verify them.

Do not delete all reference data every time we replace employees.

Before deleting employees, every excel department/title/level should resolve to exactly one job_titles row.

## inserts

Use parameterized batch inserts. No building a giant query by joining excel text directly into SQL.

Also don't do 10k separate DB calls. Builder can choose a reasonable batch size and tell us why.

## env and logs

Read DATABASE_URL from process.env only. Never read .env files.

Don't log:

- DB url/password
- full employee rows
- salaries

Success output can just be:

```text
Seeded 10000 employees and 10000 compensation records.
```

## tests I care about

- fails without --replace
- refuses production
- bad workbook does not delete anything
- inserts exactly 10k employees + 10k salary rows
- all first salary rows are version 1 + INITIAL_IMPORT
- second seed replaces, it should not become 20k
- force a failure after delete and check full rollback
- few selected DB rows match exact excel rows
- old workbook generator tests still pass

## not doing in this task

No user-facing import, no partial updates, no preview UI, no express routes, no frontend, no auth, no AI/MCP.

First migration needs to finish and pass review. Only after that this seed task becomes READY.
