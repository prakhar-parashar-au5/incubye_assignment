# Builder task 05: Migrate backend to strict TypeScript

**Status:** READY

## Goal

Convert the existing backend source, scripts, and tests from JavaScript to strict TypeScript without changing application behavior.

## Read first

- `builder_docs/parent_instructions/index.md`
- `docs_human/06-typescript-migration-raw.md`
- `docs/12-typescript-migration-design.md`
- `docs/13-typescript-migration-test-plan.md`
- `builder_docs/responses/03-workbook-database-seed.md`
- `builder_docs/responses/04-hr-access-control.md`

## Work order

1. Record the complete passing JavaScript baseline.
2. Check current official TypeScript, Node.js ESM, tsx, and typescript-eslint documentation.
3. Add strict TypeScript configuration and scripts.
4. Migrate production modules in small groups.
5. Migrate command scripts.
6. Migrate tests.
7. Remove JavaScript compatibility from application directories.
8. Run strict type checking, lint, fast tests, and real-MySQL tests.
9. Build production output.
10. Run compiled command smoke tests, including SQL and workbook asset lookup.
11. Write the builder response and stop.

## Rules

- Use strict TypeScript.
- Use ESM and Node-compatible module resolution.
- Do not add an ORM or query builder.
- Do not change database schema or product behavior.
- Do not remove runtime validation.
- Do not use explicit `any`, `@ts-ignore`, `@ts-nocheck`, or disabled strict mode.
- Use `unknown` at untrusted boundaries and narrow it.
- Keep MySQL `DECIMAL` values as strings.
- Keep current test meaning and coverage.
- Do not read `.env` files.
- Do not run Git commands.
- Do not begin Express routes or frontend work.

## Response

Write:

```text
builder_docs/responses/05-typescript-migration.md
```

Include:

- Tool versions and official sources checked.
- Files migrated.
- Important type design decisions.
- Type errors that exposed real assumptions or defects.
- Existing and new test results.
- Production build result.
- Compiled command smoke results.
- Asset path decisions.
- Any assertion, `unknown` narrowing, or library-type workaround.
- Known limitations.
- Confirmation that no behavior, schema, Git, or later feature work changed.
