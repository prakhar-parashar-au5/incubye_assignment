# Backend TypeScript migration test plan

**Status:** Approved before migration

## Baseline

Before changing file extensions, record the passing baseline:

- Lint.
- Fast tests.
- Real-MySQL tests.
- Workbook generation.
- Migration repeat behavior.
- Database seed counts.
- Demo-user seed behavior.

Do not claim that a test failed first when it was already green before the refactor.

## Type-check tests

The final type check must reject:

- Access to an unknown workbook value before narrowing.
- A salary number where a database decimal string is required.
- An unsupported country, currency, level, status, pay frequency, role, or audit action.
- A database row without required fields.
- A scoped principal without country or department arrays.
- A session token result without required IDs and expiry.
- An unsupported error code where a closed union is expected.

Use compiler behavior and focused type fixtures where useful. Do not add large type-only test frameworks.

## Lint policy tests

Configure lint to reject:

- Explicit `any` in application code.
- `@ts-ignore`.
- `@ts-nocheck`.
- Unsafe unused values introduced during migration.

Do not scan generated dependencies or compiled output.

## Existing behavior tests

All existing tests must pass after migration:

- Workbook generator and validator tests.
- Workbook parser and seed safety tests.
- Migration runner and schema tests.
- Database seed and rollback tests.
- Password, JWT, session, scope, and audit tests.

Do not weaken assertions to make the migration pass.

## Build tests

Confirm that:

- `npm run build` succeeds from a clean `dist/` state.
- Test files are not emitted into `dist/`.
- Compiled ESM imports resolve in Node.
- Source maps are created only if selected by the build policy.
- The compiled workbook command can show help and generate a temporary workbook.
- The compiled migration command finds the real SQL migration directory.
- The compiled seed command finds or accepts the generated workbook path.
- The compiled demo-user command starts with injected environment values.

Do not read `.env` files.

## Database regression tests

Against the dedicated `_test` database:

- Apply migrations from compiled code.
- Apply migrations again and confirm no migration repeats.
- Seed the workbook through compiled code.
- Confirm 10,000 employees and 10,000 compensation records.
- Confirm exact decimal strings remain strings.
- Confirm rollback behavior remains intact.
- Seed demo users through compiled code.
- Confirm Meera and Rohan roles and scopes.

## File migration checks

At completion:

- No `.js` application files remain under `src/`, `scripts/`, or `test/`.
- SQL and workbook files remain unchanged unless an approved correction exists.
- Compiled output is ignored by Git.
- `node_modules` remains ignored.
- The package contains no unnecessary JavaScript compatibility layer.

## Test quality

- Preserve existing behavior assertions.
- Add tests only for new type or compiled-build risks.
- Do not duplicate every runtime test as a type test.
- Record type errors and build errors actually found during migration.
- Explain how each new check prevents a plausible TypeScript migration defect.
