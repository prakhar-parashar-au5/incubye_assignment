// Evaluator-only oracle fixtures against real MySQL (AI Task 04, issue
// 04-evaluator-oracle-fixtures): guards, dry run, apply through the salary
// adjustment service, idempotent re-run, recorded vs effective dates, product
// selection of the future change, scope, exact money, and an unchanged seed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import type { Principal } from '../../src/access/sessions.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import { FUTURE_EFFECTIVE_DAYS, OracleFixtureRefusedError, databaseNameOf, prepareOracleFixtures } from '../../src/evaluation/oracle-fixtures.js';
import type { OracleManifest } from '../../src/evaluation/oracle-fixtures.js';
import { seedDatabase } from '../../src/seed/seed-database.js';
import { createSourceWorkbook } from '../../src/source-workbook/source-workbook.js';
import { selectRows } from '../support/db.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const DATABASE = databaseNameOf(DATABASE_URL) ?? '';
const NOW = new Date('2026-11-17T10:00:00.000Z');
const clock = () => NOW;
const PASSWORD = 'synthetic-shared-demo-password';

let pool: Pool;
let dir: string | undefined;
let rohan: Principal;
const count = async (sql: string) => Number((await selectRows(pool, sql))[0]?.n);
const run = (apply: boolean, overrides: Partial<Parameters<typeof prepareOracleFixtures>[0]> = {}) =>
  prepareOracleFixtures({ pool, apply, clock, appEnv: 'test', databaseName: DATABASE, confirmDatabase: DATABASE, ...overrides });
const cents = (amount: string) => BigInt(amount.replace('.', ''));

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  dir = await mkdtemp(path.join(tmpdir(), 'acme-oracle-'));
  const workbookPath = path.join(dir, 'acme-employees.xlsx');
  await createSourceWorkbook({ outputPath: workbookPath, seed: 20261114, generationDate: '2026-11-14' });
  await seedDatabase({ databaseUrl: DATABASE_URL, workbookPath, replace: true, appEnv: 'test' });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });
  await bootstrapHrUser(pool, { email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  const rohanId = await bootstrapHrUser(pool, { email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  rohan = { hrUserId: rohanId, email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Support', 'Tech'], sessionId: 'n/a', sessionExpiresAt: NOW };
});
after(async () => {
  await pool?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('guards', () => {
  // Detects: fixtures written to production or to a database that is not isolated.
  test('production, unknown APP_ENV, unsafe names, an unconfirmed name, and a different connected database are refused before any write', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM compensation_records');
    for (const overrides of [
      { appEnv: 'production' }, { appEnv: undefined }, { appEnv: 'staging' },
      { databaseName: 'acme', confirmDatabase: 'acme' }, { databaseName: 'acme_prod', confirmDatabase: 'acme_prod' },
      { confirmDatabase: undefined }, { confirmDatabase: `${DATABASE}x` },
      { databaseName: 'other_eval_test', confirmDatabase: 'other_eval_test' },
    ]) {
      await assert.rejects(run(true, overrides), OracleFixtureRefusedError, JSON.stringify(overrides));
    }
    assert.equal(await count('SELECT COUNT(*) AS n FROM compensation_records'), before);
  });

  test('databaseNameOf never returns credentials', () => {
    assert.equal(databaseNameOf('mysql://user:secret@127.0.0.1:3324/acme_ai_eval_test'), 'acme_ai_eval_test');
    assert.equal(databaseNameOf('not a url'), null);
  });
});

describe('fixtures', () => {
  let applied: OracleManifest;

  // Detects: a dry run that writes, or a planned manifest that differs from what apply creates.
  test('dry run writes nothing and plans both fixtures', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM compensation_records');
    const plan = await run(false);
    assert.equal(plan.mode, 'DRY_RUN');
    assert.equal(await count('SELECT COUNT(*) AS n FROM compensation_records'), before);
    assert.deepEqual(plan.fixtures.map((f) => [f.fixture, f.versions.filter((v) => v.planned).length, f.oracle.recordedAt]), [['MULTI_VERSION_CURRENT', 1, null], ['RECENT_FUTURE_EFFECTIVE', 1, null]]);
    applied = await run(true);
    assert.deepEqual(applied.fixtures.map((f) => f.employeeCode), plan.fixtures.map((f) => f.employeeCode), 'apply picks the planned employees');
    for (const [i, fixture] of plan.fixtures.entries()) {
      const planned = fixture.versions.find((v) => v.planned);
      const real = applied.fixtures[i]?.versions.find((v) => v.version === planned?.version);
      assert.deepEqual([real?.annualBaseSalary, real?.annualBonus, real?.effectiveFrom], [planned?.annualBaseSalary, planned?.annualBonus, planned?.effectiveFrom]);
    }
  });

  // Detects: conflated recorded/effective dates, a stale or invented amount, or a future change selected early.
  test('applied manifest: distinct recordedAt and effectiveFrom, exact money, correct selection, and scope', async () => {
    const [multi, future] = applied.fixtures;
    assert.ok(multi && future);
    assert.equal(applied.evaluationClock, NOW.toISOString());
    assert.ok(applied.migrations.includes('007_ai_trace_actor_scope.sql'));

    assert.deepEqual(multi.versions.map((v) => [v.version, v.reason, v.state]), [[1, 'INITIAL_IMPORT', 'HISTORICAL'], [2, 'MARKET_ADJUSTMENT', 'CURRENT']]);
    assert.deepEqual([multi.oracle.selectedVersion, multi.oracle.recordedAt, multi.oracle.effectiveFrom, multi.oracle.recordedWithinRecentWindow],
      [2, NOW.toISOString(), '2026-11-17', true]);
    assert.notEqual(multi.versions[0]?.recordedAt, multi.versions[1]?.recordedAt, 'the import and the change were recorded at different times');

    const effective = new Date(Date.parse('2026-11-17T00:00:00.000Z') + FUTURE_EFFECTIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(future.versions.map((v) => [v.version, v.state]), [[1, 'CURRENT'], [2, 'UPCOMING']]);
    assert.deepEqual([future.oracle.selectedVersion, future.oracle.recordedAt, future.oracle.effectiveFrom, future.oracle.recordedWithinRecentWindow],
      [1, NOW.toISOString(), effective, true]);
    assert.notEqual(future.oracle.recordedAt?.slice(0, 10), future.oracle.effectiveFrom);

    for (const fixture of [multi, future]) {
      // Values come from the stored rows exactly; cash is base + bonus in exact cents.
      const rows = await selectRows(pool, `SELECT c.version, c.annual_base_salary, c.annual_bonus, c.currency FROM compensation_records c
        JOIN employees e ON e.id = c.employee_id WHERE e.employee_code = ? ORDER BY c.version`, [fixture.employeeCode]);
      assert.deepEqual(fixture.versions.map((v) => [v.version, v.annualBaseSalary, v.annualBonus, v.currency]), rows.map((r) => [Number(r.version), r.annual_base_salary, r.annual_bonus, r.currency]));
      for (const v of fixture.versions) assert.equal(cents(v.annualCashCompensation), cents(v.annualBaseSalary) + cents(v.annualBonus));
      assert.deepEqual([fixture.country, fixture.department, fixture.employmentStatus], ['IN', 'Tech', 'CURRENTLY_WORKING']);
      assert.deepEqual(fixture.visibleTo, [{ displayName: 'Meera Iyer', role: 'ADMIN' }, { displayName: 'Rohan Mehta', role: 'SCOPED' }]);
    }

    // The product's own directory agrees: the future change is not current yet, and Scoped HR can see both employees.
    const directory = createDirectoryService({ pool, exchangeRate: null, clock });
    const futureDetail = await directory.detail(rohan, future.employeeCode);
    const multiDetail = await directory.detail(rohan, multi.employeeCode);
    assert.equal(futureDetail?.compensation?.annualBaseSalary, future.versions[0]?.annualBaseSalary);
    assert.equal(multiDetail?.compensation?.annualBaseSalary, multi.versions[1]?.annualBaseSalary);

    const text = JSON.stringify(applied);
    for (const forbidden of ['mysql://', 'acme_local', PASSWORD, 'hrUserId', 'employee_id', '"id"']) assert.ok(!text.includes(forbidden), forbidden);
    assert.deepEqual(applied.placeholders, { working_multi_version_code: multi.employeeCode, recent_future_effective_code: future.employeeCode });
  });

  // Detects: a second run duplicating changes, or the normal seed being altered.
  test('re-running finds the same fixtures and writes nothing; only two non-import records exist', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM compensation_records');
    const again = await run(true);
    assert.equal(await count('SELECT COUNT(*) AS n FROM compensation_records'), before);
    assert.deepEqual(again.fixtures.map((f) => [f.employeeCode, f.versions.length]), applied.fixtures.map((f) => [f.employeeCode, f.versions.length]));
    assert.equal(await count("SELECT COUNT(*) AS n FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT'"), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM compensation_records WHERE change_reason = 'INITIAL_IMPORT'"), await count('SELECT COUNT(*) AS n FROM employees'));
  });
});
