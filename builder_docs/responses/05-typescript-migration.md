# Builder response 05: Backend TypeScript migration

**Task:** `builder_docs/parent_instructions/05-typescript-migration.md`
**Status:** Complete and verified. Not committed. Waiting for review.
**Scope kept:** no Express routes, no frontend, no schema change, no ORM or query builder.

## Task completed

- All backend source, command scripts, and tests are converted from JavaScript to strict TypeScript.
- Strict type checking, lint, all existing tests, and the production build pass.
- The compiled commands find the SQL and workbook assets.

## Baseline recorded before any change (JavaScript)

| Check | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm test` | 196 tests, 196 pass |
| `npm run test:db` | 123 tests, 123 pass |
| `npm run generate:workbook -- --output <tmp>` | 10,000 rows written |
| Reset, then `db:migrate` twice | `Applied 2` (001, 002), then `Applied 0 … 2 already applied` |
| `APP_ENV=development npm run db:seed -- --replace` | `Seeded 10000 employees and 10000 compensation records.` |
| `db:seed-demo-users` twice | both `created`, then both `already present` |
| Application `.js` files under `src/`, `scripts/`, `test/` | 47 |
| SHA-256 of `db/migrations/*.sql` and `generated/acme-employees.xlsx` | recorded; unchanged at the end (`shasum -c`: all OK) |

All of these were already green, so none is reported below as having failed first.

## Tool versions and official sources checked

| Tool | Version | Source checked |
|---|---|---|
| TypeScript | 6.0.3 | [TSConfig reference](https://www.typescriptlang.org/tsconfig/) (`rewriteRelativeImportExtensions`, `module`/`moduleResolution`, `useUnknownInCatchVariables`) and the [TypeScript 6.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) (new defaults: explicit `types`, `rootDir` defaults to the tsconfig directory, `strict` on by default) |
| typescript-eslint | 8.72.2 | [Dependency versions](https://typescript-eslint.io/users/dependency-versions/): TypeScript `>=4.8.4 <6.1.0`; npm `peerDependencies` say the same |
| tsx | 4.23.15 | [tsx repository docs](https://github.com/privatenumber/tsx) (`docs/dev-api/node-cli.md`: `node --import tsx`; `docs/node-enhancement.md`: test-runner support), MIT, not archived |
| @types/node | 22.20.5 | matches Node v22.23.1 |
| Node ESM | v22.23.1 | `"type": "module"`; `nodenext` resolution needs explicit file extensions in relative imports |

**Why not TypeScript 7.** `npm view typescript` reports `latest` = 7.0.2, the native Go compiler. typescript-eslint 8.72.2 declares `typescript <6.1.0`, and several reports state that TypeScript 7.0 ships no programmatic API, which typescript-eslint needs (for example [this one](https://dev.to/gabrielanhaia/typescript-7-has-no-stable-compiler-api-yet-thats-why-typescript-eslint-wont-install-4pa)). I chose TypeScript 6.0.3, the newest supported release, so `tsc`, lint, and tests share one compiler.

## Files migrated

- **`src/` (23 files):** every `.js` file renamed to `.ts` and typed.
- **New in `src/`:** `src/paths.ts` (asset paths) and `src/errors.ts` (narrowing helpers for caught values).
- **`scripts/` (4 files):** `generate-workbook.ts`, `migrate.ts`, `seed-database.ts`, `seed-demo-users.ts`.
- **`test/` (20 files):** all renamed and typed.
- **New in `test/`:**
  - `test/support/db.ts`: typed `selectRows` / `execStatement`.
  - `test/support/thrown.ts`: reads fields from caught `unknown` values.
  - `test/support/must.ts`: fails loudly when an expected test-setup value is missing.
  - `test/types/type-contracts.ts`: compile-time checks.
  - `test/lint-policy.test.ts`: lint-policy tests.
- **Config:** new `tsconfig.json` (type checking for all files, no emit) and `tsconfig.build.json` (production: `src` and `scripts` only). `eslint.config.js` now uses typescript-eslint and stays JavaScript, the config format ESLint loads directly.
- **`package.json`:**
  - New scripts: `typecheck`, `build`, `check`.
  - `test` and `test:db` run `node --import tsx --test` on `*.test.ts`.
  - `db:migrate`, `db:seed`, `db:seed-demo-users`, and `generate:workbook` run through `tsx`.
  - New dev dependencies: `typescript`, `typescript-eslint`, `tsx`, `@types/node`.
- **`.gitignore`:** adds `dist/`. `node_modules/` is still ignored.
- **`README.md`:** commands, layout, and a TypeScript build and assets section.
- **Unchanged:** SQL migrations, `docker-compose.yml`, and the generated workbook (hashes verified).

At the end, `src/`, `scripts/`, and `test/` contain 0 `.js`, `.mjs`, or `.cjs` files. There is no `allowJs`, `checkJs`, or compatibility layer.

## Compiler and lint policy

- **Compiler.** `strict`, `noImplicitAny`, `useUnknownInCatchVariables`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, with `module`/`moduleResolution` `nodenext`, target `es2023`, and `types: ["node"]`.
- **`skipLibCheck: true`.** It skips checking library declaration files only; our code is fully checked.
- **Not enabled:** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Turning them on would need many extra checks in tests; see open decision 2.
- **Lint rules:**
  - `@typescript-eslint/no-explicit-any: error`.
  - `ban-ts-comment`: `@ts-ignore` and `@ts-nocheck` banned; `@ts-expect-error` allowed only with a description of at least 10 characters.
  - `no-unused-vars` and `consistent-type-imports`.
  - `dist/`, `generated/`, and `node_modules/` are ignored.
- **Results.** 0 explicit `any` and 0 `@ts-ignore`/`@ts-nocheck` in `src/`, `scripts/`, and `test/`. All 22 `@ts-expect-error` lines are in `test/types/type-contracts.ts`, each with a reason. The banned comments appear only inside string samples in `lint-policy.test.ts`.

## Important type decisions

- **One source for each union.** `constants.ts` lists use `as const`. `Department`, `Level`, `CountryCode`, `Currency`, `EmploymentStatus`, `PayFrequency`, `Column`, and `ChangeReason` are derived from those lists, so a value and its type cannot drift. `Role`, `HrStatus`, `AuditAction`, and `SeedAppEnv` are derived the same way. `isOneOf(list, value)` is the shared runtime narrowing guard.
- **Untrusted input stays `unknown`.**
  - `validateEmployee` takes `UnvalidatedEmployee` (`{ [column]?: unknown }`).
  - The workbook reader produces `unknown` cells.
  - `createHrUser` / `bootstrapHrUser` / `setCountryScopes` / `setDepartmentScopes` / `setHrUserStatus` take `unknown` fields, because they will receive HTTP input.
  - Also `unknown`: `assertSeedAllowed` (`APP_ENV`, `--replace`), `ensureDemoUsers` (env passwords), `signIn`, `authenticate`, `signOut`, `verify(token)`, `hashPassword`, `verifyPassword`, and `resolveDatabaseUrl`.

  The existing runtime validators do all the narrowing; none was removed.
- **Money.** `DecimalString` is a branded `string`, and only `toDecimalString` creates it. `SeedEmployeeRow.annual_base_salary` and `annual_bonus` are `DecimalString`, so a number cannot reach the DECIMAL insert. Values read from MySQL stay strings (`decimalNumbers: false`).
- **Database rows.** Each query names its row shape (`interface … extends RowDataPacket`) at the boundary, for example `LockRow`, `SessionUserRow`, `CountryRow`. Writes use `ResultSetHeader`. `Pool | Connection` is accepted where both work (mysql2 types `Pool` as extending `Connection`).
- **Principals and policy.**
  - `Principal` (from `authenticate`) has `role: Role` and `status: HrStatus`, narrowed from the database.
  - `AccessSubject` (the policy input) keeps `role: string` and `status: string` on purpose: the policy is the last check and must fail closed on any value. The existing "unknown role has no access" test depends on that.
  - Scope arrays are required in both types.
- **Sessions.** `SessionTokens`, `SessionClaims`, and `VerifiedSessionToken` (`hrUserId`, `sessionId`, `expiresAt`, all required). `AuthenticationFailureReason` is a closed union.
- **Error codes.** Closed unions: `AccessErrorCode`, `SourceWorkbookErrorCode`, and literal `code` fields (`INVALID_WORKBOOK`, `INVALID_TOKEN`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`). Messages are unchanged.

## Type errors that exposed real assumptions or defects

The first strict run found 321 errors in `src/` and `scripts/`, and 569 in `test/`. Most were missing annotations. These were real findings:

1. **ExcelJS type gap: `worksheet.dataValidations`.** It exists at runtime (`lib/doc/data-validations.js`) but is not in `index.d.ts`, so our one-range-per-column workaround from Task 01 used an undeclared API. A small adapter, `rangeDataValidations`, now checks that `add` exists at runtime before calling it.
2. **ExcelJS type gap: `cell.sharedFormula`.** The formula check reads it, but it is not declared on `Cell`. Now read with `Reflect.get`. Behaviour is unchanged.
3. **Non-string employee ID (behaviour change, open decision 1).** `EMPLOYEE_ID_PATTERN.test(value)` converted a non-string to text, so an array `['ACME00001']` passed the ID check. The email check would then crash on `employeeId.toLowerCase()`. The typed validator requires `typeof id === 'string'`.
   - This changes behaviour only for non-string IDs, which no current caller can produce: the reader passes only strings and the generator only builds strings.
   - No test changed.
   - The design asks to report a confirmed defect before changing behaviour. I made the change together with the typing, so it is listed here for approval.
4. **Database role and status are only `string` to the driver.** `authenticate` and the HR state loader now narrow `role`/`status` with `isOneOf`. They throw `unexpected role or status value read from hr_users`, a path the ENUM columns make unreachable.
5. **Unreachable lookup gaps:**
   - `ensureReferenceData`: a department id missing from its own map now throws a `ReferenceDataError`.
   - `migrate.ts`: `GET_LOCK` rows are read as `lockRows[0]?.locked`.
   - Both paths are unreachable in practice.
6. **Assets would have broken in the build.** `migrate.ts` (`new URL('../../db/migrations/', import.meta.url)`) and `seed-database.ts` / `generate-workbook.ts` (`../../generated/…`, `../generated/…`) are relative to the source layout. From `dist/src/db/migrate.js` that path points to `dist/db/migrations`, which does not exist. See the asset decision below.
7. **Command tests spawned `scripts/*.js` with plain Node.** After migration they would run the old files, or fail if those files no longer exist. They now spawn `node --import tsx scripts/*.ts`.

## Asset path decision

`src/paths.ts` walks up from its own file to the nearest `package.json`. That is `express-backend/` from both `src/paths.ts` (tsx) and `dist/src/paths.js` (compiled); `dist/` never contains a `package.json`. It exports `PACKAGE_ROOT`, `MIGRATIONS_DIR` (`express-backend/db/migrations`), and `DEFAULT_WORKBOOK_PATH` (`express-backend/generated/acme-employees.xlsx`).

- I rejected copying assets into `dist/`. The SQL would then exist in two places that could drift, and the generator would write its default workbook under `dist/`.
- **Consequence for deployment:** `db/migrations/` (and `generated/`, if the seed runs there) must ship next to `dist/`.

## Every assertion, `unknown` narrowing, and library-type workaround

Type assertions (`as`), each next to the runtime proof:

| Location | Assertion | Why it is safe |
|---|---|---|
| `source-workbook.ts` | `employees as readonly EmployeeRecord[]` | Only after `validateEmployeeDataset` returns no errors |
| `workbook-reader.ts` | `employees as EmployeeRecord[]` | Only after every row passed `readCell` and `validateEmployee` with zero errors |
| `workbook-reader.ts` | `… as DecimalString` | Inside `toDecimalString`, the only constructor; the format is built two lines above |
| `workbook-writer.ts` | `candidate as RangeDataValidations` | After a runtime check that `add` is a function (ExcelJS type gap) |
| `employee-generator.ts`, `employee-dataset.ts` | `Object.entries(…) as [K, number][]` | `Object.entries` widens keys to `string`; the keys are exactly the typed record's keys |
| `seeded-random.ts`, `employee-generator.ts` (`at`) | `items[i] as T` | Index is within bounds by construction (`noUncheckedIndexedAccess` is off; see open decision 2) |
| `iso-date.ts` | `match.map(Number) as [number, …]` | The regex has exactly three groups |
| `hr-users.ts` | `values as string[]` | After checking that every element is a non-empty string |
| `test/support/db.ts` | `result as Row[]`, `result as ResultSetHeader` | After `Array.isArray` separates row sets from write headers; mysql2's `OkPacket` is the deprecated name of the same header |
| `test/support/test-database.ts` | `url as string` | After `requireTestDatabaseUrl` proved a non-empty string |

`Reflect.get` reads: ExcelJS `sharedFormula`, ExcelJS `dataValidations`, and `test/support/thrown.ts` (fields of thrown values).

## Test changes

No assertion was removed or weakened.
- Per-file assertion counts were compared against a snapshot taken before editing: every file is the same, except `source-workbook.test.ts` (27 → 28).
- Per-file `test(` counts are identical.

Mechanical changes:
- Typed helpers (`query`/`exec`, `assertRejects`, `assertAuthFails`, `domainError`) and typed `let` declarations.
- Caught values read through `thrown(error)`.
- Command tests spawn `.ts` scripts through `tsx`.
- **`must(value, what)`** replaces places where the JavaScript tests would have crashed with a `TypeError` on a missing `find()` or `rows[0]` result. Same failure, clearer message.
- **`source-workbook.test.ts`, header test:** now `assert.ok(Array.isArray(values))` before `.slice(1)`. ExcelJS types `row.values` as array-or-object. This is the one added assertion.
- **`source-workbook.test.ts`, date checks:** `assert.match(String(cell.value), …)`. The first check already asserts the cell type is String; for end dates, a non-string still fails the regex.
- **`employee-dataset.test.ts`:** `assert.match(rowError ?? '', …)`. A missing row error still fails.

## New tests and the defects they detect

| Test | Detects |
|---|---|
| `test/types/type-contracts.ts` (22 compile-time checks, run by `npm run typecheck`) | Unknown workbook value used before narrowing. Number or unchecked string used as `DecimalString`. Seed row with a numeric salary. Unsupported country, currency, level, status, pay frequency, role, audit action, or change reason. Replacement row without `job_title_id`, seed row without `email`. Principal or policy call without scope arrays. Verified token without `expiresAt` or `sessionId`. Unsupported `AccessError`, `AuthenticationError`, or `SourceWorkbookError` code. If any type is loosened, its `@ts-expect-error` becomes unused and the type check fails |
| `test/lint-policy.test.ts` (6, real ESLint config via `ESLint.lintText`) | Lint no longer rejecting explicit `any`, `@ts-ignore`, `@ts-nocheck`, reasonless `@ts-expect-error`, or unused values. Control: clean code has no findings |

**Red evidence.** Both new checks passed on their first run, because the types and config already existed. I used mutation checks instead:
- With `DecimalString` changed to plain `string`, `npm run typecheck` failed with `TS2578: Unused '@ts-expect-error' directive` at the unchecked-string contract.
- With `no-explicit-any` set to `off`, `lint-policy.test.ts` failed (`not ok 1 - rejects explicit any`).
- Both were restored; a marker search returned 0 matches.

## Results

| Command | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0, 0 errors |
| `npm run check` (lint, typecheck, fast tests) | exit 0 |
| `npm test` | 202 tests, 202 pass (the 196 existing plus 6 lint-policy tests) |
| `DATABASE_URL=…/acme_test npm run test:db` | 123 tests, 123 pass, about 5.8 s (same 123 as baseline) |
| `npm run generate:workbook -- --output <tmp>` | 10,000 rows |
| `npm run db:migrate`, `db:seed -- --replace`, `db:seed-demo-users` (through tsx) | `Applied 0 … 2 already applied`; `Seeded 10000 employees and 10000 compensation records.`; both demo users `created` |

## Production build

`npm run build` deletes `dist/` and then runs `tsc -p tsconfig.build.json`. A planted `dist/stale/old.js` was removed.

- **Output:** 29 files, `dist/src/**` and `dist/scripts/**` only.
- **Not emitted:** 0 test files, 0 `.map` files (source maps disabled by policy), no `package.json` in `dist/`.

## Compiled command smoke results

Run from a temporary directory outside the project, with `DATABASE_URL` set to the `_test` database:

| Check | Result |
|---|---|
| `node dist/scripts/generate-workbook.js --help` | usage printed, exit 0 |
| …`--output <tmp>/smoke.xlsx` | 10,000 rows written, exit 0 |
| …with no arguments | `output file already exists: …/express-backend/generated/acme-employees.xlsx`, exit 1. Proves the compiled default path resolves to the package's `generated/`, not `dist/` |
| Reset (0 tables), then `node dist/scripts/migrate.js` twice | `Applied 2` (001, 002), then `Applied 0 … 2 already applied`. The compiled runner found `express-backend/db/migrations` |
| `APP_ENV=development node dist/scripts/seed-database.js --replace` | default workbook found; `Seeded 10000 employees and 10000 compensation records.` |
| …`--workbook <tmp>/smoke.xlsx` | explicit path accepted; same counts |
| …with `APP_ENV=production` | refused, exit 1 |
| `APP_ENV=demo DEMO_*_PASSWORD=… node dist/scripts/seed-demo-users.js` twice | `created`, `created`, then `already present` ×2 |
| Database after the compiled runs | 10,000 employees, 10,000 compensation records; migrations `001,002`; Meera ADMIN with no scopes; Rohan SCOPED `IN` / `Support,Tech` |
| Compiled ESM import of `dist/src/seed/workbook-reader.js` and `dist/src/paths.js` | resolved; `toDecimalString(1000000.1)` = `1000000.10`; asset paths printed |
| Compiled `createPool` reading ACME00001 compensation | `{"s":"3026700.00","b":"531185.85"}`, type `string` |

**Rollback after migration.** The seed rollback test (temporary CHECK failure inside the transaction) passes in `npm run test:db` through tsx. I did not re-run it from compiled code.

**One smoke step failed and was re-run.** My first database reset command ran `node --import tsx` from the temporary directory, where `tsx` cannot be resolved (`ERR_MODULE_NOT_FOUND`). That migrate output therefore showed `Applied 0` on the existing database. I re-ran the reset from `express-backend/`, confirmed 0 tables, and then ran the compiled migrate, seed, and demo-user steps as shown above.

## Known limitations

- **Not TypeScript 7.** TypeScript is 6.0.3 until typescript-eslint supports TypeScript 7.
- **Two compile-time options are off** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Array index reads (`rows[0]`) are typed as present.
- **Lint is not type-aware.** Rules like `no-floating-promises` and `restrict-template-expressions` would need `parserOptions.project`, which is slower and outside the approved scope.
- **Deployment files.** The compiled commands read `db/migrations/` and `generated/` from the package root, so a deployment must include them beside `dist/`.
- **Type contracts are not executed.** `test/types/type-contracts.ts` is only type-checked, so it guards types, not runtime behaviour.
- **Same build tool reports.** `npm audit` still reports the existing ExcelJS `uuid` advisory; no new runtime dependencies were added.

## Open decisions

1. **Non-string employee IDs.** Approve the validator change in finding 3, or ask for the old coercion to be restored with `String(id)`.
2. **Two stricter compiler options.** Should `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` be enabled in a later task? They would add explicit checks at every index read, mostly in tests.
3. **Type-aware lint.** Enable it before the HTTP layer, where unawaited promises matter most?

## Confirmations

- No product behaviour, error message, SQL, schema, workbook format, seed data, password parameter, token claim, or access rule changed. The one exception is finding 3, reported above.
- No ORM or query builder was added.
- No `.env` file was read, and no code reads one.
- No Git command was run.
- No Express routes or frontend work were started.
- `index.md`, `docs/`, and `docs_human/` were not edited.
