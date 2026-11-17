// Evaluator-only oracle fixtures (AI Task 04, issue 04-evaluator-oracle-fixtures).
//
// Creates, or finds again, the compensation state the live AI evaluation
// needs and the normal workbook seed does not have:
//   MULTI_VERSION_CURRENT    a working, Scoped-visible employee whose second
//                            version is CURRENT, recorded at the evaluation clock
//                            (cases E01, E08, E09, E18)
//   RECENT_FUTURE_EFFECTIVE  a change recorded at the evaluation clock that takes
//                            effect FUTURE_EFFECTIVE_DAYS later (cases E09, E10)
// Every change goes through the product's own salary-adjustment service
// (preview, then Admin direct apply), so salary bands, version links, the
// one-future-change rule, and exact decimal money all apply. Nothing in the
// normal seed changes.
//
// Guards (fixture-guard.ts, shared with eval:trace-fixtures): refuses
// APP_ENV=production or any APP_ENV outside development, test, and demo;
// refuses a database whose name does not end in _test or _demo; requires the
// caller to repeat that name; and checks the connection is to it. Without `apply` it is a
// dry run: previews only (which write nothing) and a planned manifest.
//
// The manifest holds no credentials, connection details, or internal IDs.
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { Principal } from '../access/sessions.js';
import { createPreviewTokens } from '../compensation/preview-token.js';
import { createSalaryAdjustmentService } from '../compensation/salary-adjustment-service.js';
import type { SalaryAdjustmentCommand } from '../http/contract.js';
import { addMoney } from '../money/decimal.js';
import type { Currency } from '../source-workbook/constants.js';

import { FixtureRefusedError, assertFixtureTarget } from './fixture-guard.js';

export { FixtureRefusedError as OracleFixtureRefusedError, assertFixtureTargetAllowed as assertOracleFixturesAllowed, databaseNameOf } from './fixture-guard.js';
const OracleFixtureRefusedError = FixtureRefusedError;
export const FUTURE_EFFECTIVE_DAYS = 45;
export const RECENT_WINDOW_DAYS = 30;
const NOTE_PREFIX = 'EVAL-ORACLE-FIXTURE v1';
const CANDIDATE_LIMIT = 200;

type FixtureId = 'MULTI_VERSION_CURRENT' | 'RECENT_FUTURE_EFFECTIVE';
interface FixtureSpec { id: FixtureId; cases: string[]; effectiveOffsetDays: number; command: Omit<SalaryAdjustmentCommand, 'effectiveFrom' | 'note'> }
const SPECS: readonly FixtureSpec[] = Object.freeze([
  { id: 'MULTI_VERSION_CURRENT', cases: ['E01', 'E08', 'E09', 'E18'], effectiveOffsetDays: 0,
    command: { target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: '5', reason: 'MARKET_ADJUSTMENT' } },
  { id: 'RECENT_FUTURE_EFFECTIVE', cases: ['E09', 'E10'], effectiveOffsetDays: FUTURE_EFFECTIVE_DAYS,
    command: { target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: '8', reason: 'PROMOTION' } },
]);
const noteFor = (id: FixtureId): string => `${NOTE_PREFIX} ${id}`;

const isoDay = (instant: Date): string => instant.toISOString().slice(0, 10);
const addDays = (day: string, days: number): string => isoDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000));
const isoFromDb = (text: string): string => `${text.replace(' ', 'T')}Z`;

interface RecordRow extends RowDataPacket {
  version: number; annual_base_salary: string; annual_bonus: string; currency: Currency; effective_from: string; change_reason: string; created_at: string; change_note: string | null;
}
interface EmployeeRow extends RowDataPacket { employee_code: string; first_name: string; last_name: string; country_code: string; department: string; employment_status: string }

export interface ManifestVersion {
  version: number; reason: string; effectiveFrom: string; recordedAt: string | null; state: 'CURRENT' | 'UPCOMING' | 'HISTORICAL';
  annualBaseSalary: string; annualBonus: string; annualCashCompensation: string; currency: Currency; planned: boolean;
}
export interface ManifestFixture {
  /** Fixture name (not a database ID). */
  fixture: FixtureId; cases: string[]; employeeCode: string; employeeName: string; country: string; department: string; employmentStatus: string;
  visibleTo: { displayName: string; role: 'ADMIN' | 'SCOPED' }[]; versions: ManifestVersion[];
  oracle: { selectedVersion: number; recordedAt: string | null; effectiveFrom: string; recordedWithinRecentWindow: boolean | null };
}
export interface OracleManifest {
  kind: 'acme-ai-evaluation-oracle-manifest'; manifestVersion: 1; mode: 'DRY_RUN' | 'APPLIED'; evaluationClock: string; evaluationDate: string;
  recentWindowDays: number; database: string; migrations: string[]; fixtures: ManifestFixture[]; placeholders: Record<string, string>;
}

function stateOf(rows: { version: number; effective_from: string }[], today: string): Map<number, ManifestVersion['state']> {
  const effective = rows.filter((r) => r.effective_from <= today).sort((a, b) => (a.effective_from === b.effective_from ? b.version - a.version : b.effective_from.localeCompare(a.effective_from)));
  const current = effective[0]?.version;
  return new Map(rows.map((r) => [r.version, r.effective_from > today ? 'UPCOMING' : r.version === current ? 'CURRENT' : 'HISTORICAL']));
}

export async function prepareOracleFixtures({ pool, apply, clock = () => new Date(), appEnv, databaseName, confirmDatabase }: {
  pool: Pool; apply: boolean; clock?: () => Date; appEnv: unknown; databaseName: string; confirmDatabase: unknown;
}): Promise<OracleManifest> {
  await assertFixtureTarget(pool, { appEnv, databaseName, confirmDatabase });

  const now = clock();
  const today = isoDay(now);
  const [admins] = await pool.query<RowDataPacket[]>("SELECT id, email, display_name FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id LIMIT 1");
  const admin = admins[0];
  if (!admin) throw new OracleFixtureRefusedError('refusing: no active Admin HR user exists (run the demo-user seed first)');
  const principal: Principal = {
    hrUserId: Number(admin.id), email: String(admin.email), displayName: String(admin.display_name), role: 'ADMIN', status: 'ACTIVE',
    countries: [], departments: [], sessionId: randomUUID(), sessionExpiresAt: new Date(now.getTime() + 3_600_000),
  };
  // Preview tokens live only inside this process, so a random key per run is enough.
  const service = createSalaryAdjustmentService({ pool, clock, previewTokens: createPreviewTokens({ signingKey: randomUUID() + randomUUID(), clock }) });

  const chosen = new Map<FixtureId, { code: string; plannedVersion: ManifestVersion | null }>();
  for (const spec of SPECS) {
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT e.employee_code FROM compensation_records c JOIN employees e ON e.id = c.employee_id WHERE c.change_note = ? ORDER BY c.id LIMIT 1', [noteFor(spec.id)]);
    if (existing[0]) { chosen.set(spec.id, { code: String(existing[0].employee_code), plannedVersion: null }); continue; }
    const taken = [...chosen.values()].map((c) => c.code);
    // Working, India Tech (visible to the Scoped demo persona), only the initial import so far. Lowest code first: deterministic.
    const [candidates] = await pool.query<RowDataPacket[]>(`SELECT e.employee_code FROM employees e
        JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id
        WHERE e.employment_status = 'CURRENTLY_WORKING' AND e.country_code = 'IN' AND d.name = 'Tech'
          AND NOT EXISTS (SELECT 1 FROM compensation_records c WHERE c.employee_id = e.id AND (c.version > 1 OR c.change_reason <> 'INITIAL_IMPORT'))
          ${taken.length ? `AND e.employee_code NOT IN (${taken.map(() => '?').join(',')})` : ''}
        ORDER BY e.employee_code LIMIT ${CANDIDATE_LIMIT}`, taken);
    const adjustment: SalaryAdjustmentCommand = { ...spec.command, effectiveFrom: addDays(today, spec.effectiveOffsetDays), note: noteFor(spec.id) };
    let picked: { code: string; plannedVersion: ManifestVersion | null } | null = null;
    for (const row of candidates) {
      const code = String(row.employee_code);
      let preview;
      try {
        preview = await service.preview(principal, code, adjustment);
      } catch {
        continue; // outside its salary band or otherwise ineligible: try the next code
      }
      if (apply) {
        await service.applyDirect(principal, code, { previewToken: preview.previewToken, adjustment }, `eval-oracle-${spec.id.toLowerCase()}-${code}`);
        picked = { code, plannedVersion: null };
      } else {
        const { proposed, currency } = preview;
        picked = { code, plannedVersion: {
          version: preview.expectedCompensationVersion + 1, reason: spec.command.reason, effectiveFrom: adjustment.effectiveFrom, recordedAt: null,
          state: spec.effectiveOffsetDays === 0 ? 'CURRENT' : 'UPCOMING',
          annualBaseSalary: proposed.annualBaseSalary, annualBonus: proposed.annualBonus, annualCashCompensation: proposed.annualCashCompensation, currency, planned: true,
        } };
      }
      break;
    }
    if (picked === null) throw new OracleFixtureRefusedError(`no eligible employee for ${spec.id}`);
    chosen.set(spec.id, picked);
  }

  const [migrationRows] = await pool.query<RowDataPacket[]>('SELECT name FROM schema_migrations ORDER BY name');
  const [hrUsers] = await pool.query<RowDataPacket[]>(`SELECT u.id, u.display_name, u.role,
      (SELECT JSON_ARRAYAGG(cs.country_code) FROM hr_user_country_scopes cs WHERE cs.hr_user_id = u.id) AS countries,
      (SELECT JSON_ARRAYAGG(d.name) FROM hr_user_department_scopes ds JOIN departments d ON d.id = ds.department_id WHERE ds.hr_user_id = u.id) AS departments
    FROM hr_users u WHERE u.status = 'ACTIVE' ORDER BY u.display_name, u.id`);
  const list = (value: unknown): string[] => (typeof value === 'string' ? JSON.parse(value) as string[] : Array.isArray(value) ? value as string[] : []);

  const fixtures: ManifestFixture[] = [];
  for (const spec of SPECS) {
    const pick = chosen.get(spec.id);
    if (!pick) continue;
    const [[employee]] = await pool.query<EmployeeRow[]>(`SELECT e.employee_code, e.first_name, e.last_name, e.country_code, d.name AS department, e.employment_status
      FROM employees e JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id WHERE e.employee_code = ?`, [pick.code]);
    if (!employee) throw new OracleFixtureRefusedError(`fixture employee disappeared: ${spec.id}`);
    const [records] = await pool.query<RecordRow[]>(`SELECT c.version, c.annual_base_salary, c.annual_bonus, c.currency, c.effective_from, c.change_reason, c.created_at, c.change_note
      FROM compensation_records c JOIN employees e ON e.id = c.employee_id WHERE e.employee_code = ? ORDER BY c.version`, [pick.code]);
    const states = stateOf([...records, ...(pick.plannedVersion ? [{ version: pick.plannedVersion.version, effective_from: pick.plannedVersion.effectiveFrom }] : [])], today);
    const versions: ManifestVersion[] = records.map((r) => ({
      version: r.version, reason: r.change_reason, effectiveFrom: r.effective_from, recordedAt: isoFromDb(r.created_at), state: states.get(r.version) ?? 'HISTORICAL',
      annualBaseSalary: r.annual_base_salary, annualBonus: r.annual_bonus, annualCashCompensation: addMoney(r.annual_base_salary, r.annual_bonus), currency: r.currency, planned: false,
    }));
    if (pick.plannedVersion) versions.push({ ...pick.plannedVersion, state: states.get(pick.plannedVersion.version) ?? pick.plannedVersion.state });
    const marker = versions.find((v) => v.planned) ?? versions.find((v) => records.find((r) => r.version === v.version)?.change_note === noteFor(spec.id));
    if (!marker) throw new OracleFixtureRefusedError(`fixture marker missing: ${spec.id}`);
    const recordedMs = marker.recordedAt === null ? null : Date.parse(marker.recordedAt);
    fixtures.push({
      fixture: spec.id, cases: spec.cases, employeeCode: employee.employee_code, employeeName: `${employee.first_name} ${employee.last_name}`,
      country: employee.country_code, department: employee.department, employmentStatus: employee.employment_status,
      visibleTo: hrUsers.filter((u) => u.role === 'ADMIN' || (list(u.countries).includes(employee.country_code) && list(u.departments).includes(employee.department)))
        .map((u) => ({ displayName: String(u.display_name), role: u.role === 'ADMIN' ? 'ADMIN' as const : 'SCOPED' as const })),
      versions,
      oracle: {
        selectedVersion: versions.find((v) => v.state === 'CURRENT')?.version ?? 0,
        recordedAt: marker.recordedAt,
        effectiveFrom: marker.effectiveFrom,
        recordedWithinRecentWindow: recordedMs === null ? null : recordedMs > now.getTime() - RECENT_WINDOW_DAYS * 86_400_000 && recordedMs <= now.getTime(),
      },
    });
  }
  const placeholder = (id: FixtureId) => fixtures.find((f) => f.fixture === id)?.employeeCode ?? '';
  return {
    kind: 'acme-ai-evaluation-oracle-manifest', manifestVersion: 1, mode: apply ? 'APPLIED' : 'DRY_RUN',
    evaluationClock: now.toISOString(), evaluationDate: today, recentWindowDays: RECENT_WINDOW_DAYS, database: databaseName,
    migrations: migrationRows.map((r) => String(r.name)), fixtures,
    placeholders: { working_multi_version_code: placeholder('MULTI_VERSION_CURRENT'), recent_future_effective_code: placeholder('RECENT_FUTURE_EFFECTIVE') },
  };
}
