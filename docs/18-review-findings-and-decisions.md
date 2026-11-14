# Review findings and resulting decisions

**Purpose:** Record issues found during planning, implementation, and review that caused a product or technical decision to change.

This is not a list of every implementation detail. It records corrections that changed specifications, safeguards, or later work.

## Source workbook

### One salary value is authoritative

**Initial idea:** Store monthly salary, annual salary, and pay frequency.

**Issue found:** Monthly and annual values can disagree. Some annual values also do not divide into twelve exact two-decimal monthly amounts.

**Decision:** Store `annual_base_salary` as the only authoritative base salary. Keep `pay_frequency` as payment cadence. Calculate a monthly equivalent for display only.

**Affected documents:**

- `docs_human/01-source-workbook.md`
- `docs/01-source-workbook.md`
- `docs/05-initial-database-schema.md`

### Workbook examples did not match approved rules

**Issue found by builder:** The reviewed workbook document used `Backend Engineer`, which was not in the approved title list. Its sample INR salary was also below the approved `SENIOR` range.

**Decision:** Use `Senior Software Engineer` and INR `2,500,000.00` in the reviewed example.

**Evidence:** `builder_docs/responses/01-workbook-generator.md`.

### Excel validation ranges overlapped

**Issue found by builder tests:** ExcelJS created overlapping validation ranges when validation was assigned per cell. Excel could offer to repair such a workbook.

**Decision:** Add one validation range per controlled column. Add a test that inspects the generated workbook structure.

**Evidence:** `builder_docs/responses/01-workbook-generator.md`.

## Database foundation

### Compensation moved to an effective-dated ledger

**Initial option:** Store current salary on the employee row.

**Issue found during schema design:** This model cannot preserve salary history or select future compensation without overwriting data.

**Decision:** Store immutable versions in `compensation_records`. The initial import creates version `1`. Current compensation is selected by effective date and version.

**Affected documents:**

- `docs_human/03-db-schema-raw.md`
- `docs/05-initial-database-schema.md`

### MySQL rounds a third decimal place

**Issue found by builder integration test:** MySQL `DECIMAL(15,2)` rounds `1000000.105` to `1000000.11` instead of rejecting it, including under strict SQL mode.

**Decision:** Keep `DECIMAL(15,2)` in MySQL. Validate at most two decimal places before insertion. The workbook reader converts valid money to exact decimal strings.

**Evidence:**

- `builder_docs/responses/02-initial-migration.md`
- `builder_docs/responses/03-workbook-database-seed.md`

### MySQL schema migrations are not fully transactional

**Issue confirmed by builder test:** A data definition statement can remain applied when a later statement in the same migration fails.

**Decision:** Use forward-only migrations. Record a migration only after its SQL completes. Do not claim automatic rollback of partial schema changes.

**Evidence:** `builder_docs/responses/02-initial-migration.md`.

### Docker Compose could read `.env` automatically

**Issue found by planner review:** Normal Docker Compose commands can load a project `.env` file even when application code does not load it. This conflicted with the project rule against agent access to `.env` files.

**Decision:** Prefix project Compose commands with `COMPOSE_DISABLE_ENV_FILE=1`. Document that plain Compose commands must not be used by the agents.

**Evidence:**

- `builder_docs/parent_instructions/02a-migration-review-fix.md`
- `builder_docs/responses/02-initial-migration-fix.md`

## HR access control

### Scope wording was ambiguous

**Initial wording:** Country scope uses OR.

**Issue found during review:** This did not define how countries and departments combine.

**Decision:** Use OR within each list and AND across dimensions.

```text
employee country IN assigned countries
AND
employee department IN assigned departments
```

An empty list in either dimension grants no employee access.

**Affected document:** `docs_human/05-access-control-raw.md`.

### Sessions must use current database authority

**Initial idea:** A JWT could retain access for 24 hours after HR deactivation or scope changes.

**Issue found during review:** A removed user could continue to read or change compensation until token expiry.

**Decision:** Use a two-hour JWT that contains identity and session claims only. Load the current database session, HR status, and scopes for every authenticated request. Deactivation, revocation, and scope changes take effect on the next request.

**Affected documents:**

- `docs_human/05-access-control-raw.md`
- `docs/10-access-control-design.md`

### Last active administrator could be deactivated

**Issue found by planner review:** The first access implementation allowed all active administrators to be deactivated. This could lock out access management.

**Decision:** Prevent deactivation of the last active administrator. Lock active administrator rows in one order so concurrent deactivations cannot leave zero active administrators.

**Evidence:**

- `builder_docs/parent_instructions/04a-access-control-review-fix.md`
- `builder_docs/responses/04-hr-access-control-fix.md`

### Administrator scope rows were misleading

**Issue found by planner review:** The access policy ignored scope rows for administrators, but the operations allowed those rows to be stored.

**Decision:** Administrators must have empty country and department scopes. Reject creation or scope assignment that violates this rule. Scoped users can have empty lists, which grant no access.

**Evidence:** `builder_docs/responses/04-hr-access-control-fix.md`.

### Password rule differed between account creation paths

**Issue found by planner review:** Demo-user creation required a 12-character password, while normal HR-user creation accepted a one-character password.

**Decision:** Apply a 12 to 1,024 character rule to every newly created HR user. Store only Argon2id hashes.

**Evidence:** `builder_docs/responses/04-hr-access-control-fix.md`.

## TypeScript migration

### JavaScript was corrected before HTTP growth

**Initial decision:** Build the complete application in JavaScript and migrate later.

**Issue found during planning:** The target role requires strong TypeScript. Waiting until after HTTP, import, and salary features would increase migration cost.

**Decision:** Migrate the backend to strict TypeScript before adding Express routes. Present this as an early course correction, not as a planned architecture strategy.

**Affected documents:**

- `docs_human/06-typescript-migration-raw.md`
- `docs/12-typescript-migration-design.md`

### Compiled asset paths would break

**Issue found by builder:** Source-relative SQL and workbook paths pointed into `dist/` after compilation, where those assets did not exist.

**Decision:** Resolve the package root at runtime. Keep one authoritative copy of SQL migrations and the workbook outside `dist/`. Verify compiled migration and seed commands.

**Evidence:** `builder_docs/responses/05-typescript-migration.md`.

### Non-string employee ID could cause a runtime crash

**Issue found by TypeScript migration:** A non-string employee ID could pass regular-expression coercion and later fail on `toLowerCase()`.

**Decision:** Treat external employee IDs as `unknown` and require a string before format checks.

**Evidence:** `builder_docs/responses/05-typescript-migration.md`.

## Authentication API

### IP-only rate limiting did not fit the Next.js boundary

**Initial rule:** Limit five failed logins per Express caller IP in 15 minutes.

**Issue found by planner review:** The approved request path is Browser → Next.js server → Express. Express can see the Next.js service as the caller. Failures from some users could consume one shared allowance and block other accounts.

**Decision:** Key the backend limit by caller network key plus a hash of normalized login email. Do not keep the plain email in limiter state or logs. A browser-IP limit at the Next.js boundary remains future work.

**Affected documents:**

- `docs_human/07-auth-api-raw.md`
- `builder_docs/parent_instructions/06a-auth-rate-limit-fix.md`

## Employee directory and currency sorting

### Stored USD salary would become stale

**Initial idea:** Store a common USD salary column and use it for sorting.

**Issue found during planner review:** The value would duplicate native compensation and become stale when exchange rates change. It would also conflict with the rule against silent currency conversion.

**Decision:** Keep native compensation authoritative. Save a documented official exchange-rate snapshot separately. Convert inside the MySQL directory query before sorting and pagination. Return native and USD-equivalent values with rate source and date. Reject salary sorting when a required rate is missing.

**Affected documents:**

- `docs_human/08-employee-directory-apis.md`
- `docs/16-employee-directory-api-design.md`

## Review policy

When a future review changes a specification, add an entry with:

- Original decision or assumption.
- Concrete issue and evidence.
- Final candidate decision.
- Affected files.
- Test or builder response that proves the issue when available.

Do not rewrite history to make the final decision appear obvious from the start.
