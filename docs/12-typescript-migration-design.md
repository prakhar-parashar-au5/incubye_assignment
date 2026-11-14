# Backend TypeScript migration design

**Status:** Approved design. Implementation waits for Task 04 acceptance.

## Decision

Migrate the complete Express backend foundation from JavaScript to strict TypeScript before adding HTTP routes.

The JavaScript start was an early speed choice. It does not match the target role or the growing application. This migration is a course correction, not a planned product feature.

## Goal

Add compile-time checks to the existing workbook, database, seed, session, access, and audit boundaries without changing observable behavior.

All existing tests must continue to pass.

## Included files

Migrate application JavaScript under:

```text
express-backend/src/
express-backend/scripts/
express-backend/test/
```

Add TypeScript and lint configuration required for strict checking and production compilation.

Tool configuration can remain JavaScript when the tool requires or clearly prefers it. SQL, Docker Compose, Markdown, and the generated workbook do not become TypeScript.

## Compiler policy

Use ESM and Node-compatible module resolution.

Required compiler behavior:

```text
strict: true
noImplicitAny: true
useUnknownInCatchVariables: true
```

The builder can enable additional strict checks when they do not require fake types or unrelated behavior changes.

At the end of the migration:

- Application source does not depend on `allowJs`.
- Application code contains no explicit `any`.
- Application code contains no `@ts-ignore` or `@ts-nocheck`.
- `@ts-expect-error` is allowed only in a focused compile-time test with a reason.
- External values start as `unknown` until runtime validation or a narrow adapter proves their shape.

A narrow type assertion is allowed at a library boundary when library types are incomplete. Keep it close to the boundary and explain why it is safe.

## Runtime validation remains

TypeScript does not validate runtime values.

Keep runtime checks for:

- Workbook cells.
- Command-line arguments.
- Environment values.
- Database values where driver types do not prove the row shape.
- Future HTTP requests.
- Future AI tool input.

Do not remove existing validators because a TypeScript interface exists.

## Important types

Create clear types for:

- Employee workbook rows.
- Database-ready employee rows.
- Money decimal strings where useful.
- Countries, currencies, departments, levels, statuses, pay frequencies, and change reasons.
- Migration results.
- MySQL query rows and mutation results.
- HR users, principals, scopes, sessions, and audit states.
- Error codes and command options.

Prefer unions that come from one approved constant source. Avoid duplicated lists that can drift.

## Database typing

Use the MySQL driver's row and result interfaces.

Keep SQL explicit. Do not introduce an ORM or query builder during this migration.

Type each repository result at the database boundary. Convert database rows to application types before wider use.

`DECIMAL` remains a string. Do not type salary as `number` after it comes from MySQL.

## Module and build behavior

Use TypeScript source with ESM output.

Use import paths that work in compiled Node output. The production build must not depend on TypeScript path aliases that Node cannot resolve.

Compile production source and scripts into `dist/`. Do not emit test files into the production output.

The build must preserve access to required non-TypeScript assets:

- SQL migration files.
- Generated workbook when the seed command needs it.

The builder must test compiled migration, generator, seed, and demo-user commands. Do not assume source-relative asset paths still work from `dist/`.

## Commands

Add or update:

```text
npm run typecheck
npm run build
npm run check
npm test
npm run test:db
npm run generate:workbook
npm run db:migrate
npm run db:seed
npm run db:seed-demo-users
```

Use `tsx` for TypeScript command and test execution where appropriate. Use `tsc` for type checking and production compilation.

A backend `start` command is not required until the Express server exists.

## Migration rule

Do not change product behavior, database schema, SQL meaning, workbook format, seed data, password parameters, token claims, access rules, or error messages unless a required typing correction exposes a confirmed defect.

Report any such defect before changing its behavior.

## Completion criteria

- Strict type check passes.
- Production build passes.
- Lint passes.
- Existing fast tests pass.
- Existing real-MySQL tests pass.
- Workbook generation still works.
- Migration repeat run still works.
- Database seed still produces 10,000 employee and compensation rows.
- Demo-user seed still works.
- Compiled commands can locate SQL and workbook assets.
- No application JavaScript remains in `src/`, `scripts/`, or `test/`.
