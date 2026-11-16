// Salary adjustments: preview, Admin direct apply, Scoped HR requests, and
// Admin approval or cancellation.
//
// Concurrency rules (docs_human/11-salary-adjustments.md):
// - Every write runs in one READ COMMITTED transaction that first locks the
//   employee row (SELECT id FROM employees WHERE id = ? FOR UPDATE), then
//   reads the latest compensation version. The employee row serializes every
//   compensation operation on that employee. Approval and cancellation then
//   lock the request row: always employee first, request second.
// - The expected compensation version (from the preview token, or stored on
//   the request) protects against different concurrent operations.
// - The idempotency key protects retries of one operation. It is checked
//   under the employee lock, before the version check, so a retry after a
//   success returns the original result instead of a stale conflict.
//
// Nothing here logs. Salary values, notes, tokens, and keys stay out of logs.
import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { canAccessEmployee } from '../access/access-policy.js';
import { AccessError, loadHrUserState } from '../access/hr-users.js';
import type { Principal } from '../access/sessions.js';
import { EMPLOYEE_CODE, isoDate, scopeCondition, searchCondition } from '../directory/directory-repository.js';
import type { ErrorReason, PublicErrorCode, SalaryAdjustmentCommand, SalaryAdjustmentPreview, SalaryAdjustmentResult, SalaryRequestApproval, SalaryRequestList, SalaryRequestListQuery, SalaryRequestView, CompensationRecordView } from '../http/contract.js';
import { addMoney } from '../money/decimal.js';
import { errorCode } from '../errors.js';
import type { ChangeReason, CountryCode, Currency, Department, EmploymentStatus, Level, PayFrequency } from '../source-workbook/constants.js';
import { AdjustmentError, isPercentageMethod, normalizeAmountInput } from './adjustment.js';
import type { AdjustmentMethod } from './adjustment.js';
import { planAdjustment } from './plan.js';
import type { AdjustmentPlan, AdjustmentTarget, SalaryBand } from './plan.js';
import { directCommandFingerprint } from './fingerprint.js';
import { PreviewTokenError, commandDigest } from './preview-token.js';
import type { AdjustmentCommand, ConfirmationMode, PreviewTokens } from './preview-token.js';

export type SalaryAdjustmentErrorCode = Extract<PublicErrorCode,
  'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'STALE_VERSION' | 'DUPLICATE_OPERATION'
  | 'PENDING_REQUEST_EXISTS' | 'REQUEST_NOT_PENDING' | 'EMPLOYEE_INELIGIBLE'>;

export class SalaryAdjustmentError extends Error {
  readonly code: SalaryAdjustmentErrorCode;
  readonly reason: ErrorReason | undefined;
  /** A public message; undefined means the code's standard message. */
  readonly publicMessage: string | undefined;

  constructor(code: SalaryAdjustmentErrorCode, { reason, message }: { reason?: ErrorReason; message?: string } = {}) {
    super(message ?? code);
    this.name = 'SalaryAdjustmentError';
    this.code = code;
    this.reason = reason;
    this.publicMessage = message;
  }
}

export const EMPLOYEE_NOT_FOUND = 'Employee not found.';
export const REQUEST_NOT_FOUND = 'Salary change request not found.';

export const STALE_REASONS = Object.freeze({
  VERSION: 'Compensation changed after this request was created.',
  REQUESTER_INACTIVE: 'The requester is no longer active.',
  REQUESTER_SCOPE: "The employee is outside the requester's current scope.",
  INELIGIBLE: 'The employee is no longer eligible.',
  DATE_PASSED: 'The effective date has passed.',
  FUTURE_CONFLICT: 'Another approved future change exists.',
  BAND: 'The salary band no longer permits this result.',
});

export interface Replayable<T> {
  value: T;
  replayed: boolean;
}

export interface SalaryAdjustmentService {
  preview(principal: Principal, employeeCode: string, command: SalaryAdjustmentCommand): Promise<SalaryAdjustmentPreview>;
  applyDirect(principal: Principal, employeeCode: string, confirmation: { previewToken: string; adjustment: SalaryAdjustmentCommand }, idempotencyKey: string): Promise<Replayable<SalaryAdjustmentResult>>;
  submitRequest(principal: Principal, employeeCode: string, confirmation: { previewToken: string; adjustment: SalaryAdjustmentCommand }, idempotencyKey: string): Promise<Replayable<SalaryRequestView>>;
  listRequests(principal: Principal, query: SalaryRequestListQuery): Promise<SalaryRequestList>;
  getRequest(principal: Principal, requestId: string): Promise<SalaryRequestView>;
  approve(principal: Principal, requestId: string, idempotencyKey: string): Promise<Replayable<SalaryRequestApproval>>;
  cancel(principal: Principal, requestId: string, note: string, idempotencyKey: string): Promise<Replayable<SalaryRequestView>>;
}

type Db = Pool | PoolConnection;

interface EmployeeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  employment_status: EmploymentStatus;
  job_title_id: number;
  country_code: CountryCode;
  department: Department;
  job_title: string;
  level: Level;
}
interface RecordRow extends RowDataPacket {
  id: number;
  version: number;
  annual_base_salary: string;
  annual_bonus: string;
  currency: Currency;
  pay_frequency: PayFrequency;
  effective_from: string;
  change_reason: ChangeReason;
}
interface StoredRecordRow extends RecordRow {
  employee_id: number;
  change_note: string | null;
  previous_compensation_record_id: number | null;
  source_request_id: number | null;
  created_at: string;
  changed_by_name: string | null;
  changed_by_email: string | null;
  source_public_id: string | null;
  operation_fingerprint: string | null;
}
interface BandRow extends RowDataPacket {
  currency: Currency;
  min_annual_base_salary: string;
  max_annual_base_salary: string;
  max_annual_bonus: string;
  min_percentage_increase: number;
  max_percentage_increase: number;
  min_percentage_decrease: number;
  max_percentage_decrease: number;
}
interface RequestRow extends RowDataPacket {
  id: number;
  public_id: string;
  employee_id: number;
  requested_by_hr_user_id: number;
  adjustment_target: AdjustmentTarget;
  adjustment_method: AdjustmentMethod;
  input_value: string;
  currency: Currency;
  previous_target_value: string;
  proposed_target_value: string;
  requested_against_version: number;
  base_compensation_version: number;
  effective_from: string;
  change_reason: Exclude<ChangeReason, 'INITIAL_IMPORT'>;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'CANCELLED' | 'STALE';
  decided_by_hr_user_id: number | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}
interface RequestViewRow extends RequestRow {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department: Department;
  job_title: string;
  level: Level;
  country_code: CountryCode;
  employment_status: EmploymentStatus;
  requester_name: string;
  requester_email: string;
  decider_name: string | null;
  decider_email: string | null;
  resulting_version: number | null;
}
interface CountRow extends RowDataPacket {
  n: string;
}
interface IdRow extends RowDataPacket {
  id: number;
}

/** The compensation state of one employee, read after the employee lock. */
interface CompensationContext {
  employee: EmployeeRow;
  records: RecordRow[];
  maxVersion: number;
  /** The record the adjustment is calculated from: current (or upcoming for SOON_TO_JOIN). */
  baseline: RecordRow | null;
  state: 'CURRENT' | 'UPCOMING';
  /** The approved future change, if any: a non-import record effective after today. */
  futureChange: RecordRow | null;
  band: SalaryBand | null;
}

const toIso = (dbTime: string): string => `${dbTime.replace(' ', 'T')}Z`;
const fullName = (row: { first_name: string; last_name: string }): string => `${row.first_name} ${row.last_name}`;

/** "  x  " -> "x"; blank or missing -> null. */
const normalizeNote = (note: string | null | undefined): string | null => {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** DECIMAL input_value back to the command's value: whole percentages, two-decimal amounts. */
const storedValue = (method: AdjustmentMethod, inputValue: string): string =>
  isPercentageMethod(method) ? inputValue.replace(/\.00$/, '') : inputValue;

function rejectAdjustment(error: unknown): never {
  if (error instanceof AdjustmentError) throw new SalaryAdjustmentError('VALIDATION_ERROR', { reason: error.reason, message: error.message });
  throw error;
}

async function selectRows<T extends RowDataPacket>(db: Db, sql: string, params: unknown[]): Promise<T[]> {
  const [rows] = await db.query<T[]>(sql, params);
  return rows;
}

const EMPLOYEE_SELECT = `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email, e.employment_status, e.job_title_id,
         e.country_code, d.name AS department, jt.name AS job_title, jt.level
  FROM employees e JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id`;

const REQUEST_VIEW_SELECT = `SELECT r.*, e.employee_code, e.first_name, e.last_name, e.email, d.name AS department, jt.name AS job_title,
         jt.level, e.country_code, e.employment_status,
         rq.display_name AS requester_name, rq.email AS requester_email,
         dc.display_name AS decider_name, dc.email AS decider_email, cr.version AS resulting_version
  FROM compensation_change_requests r
  JOIN employees e ON e.id = r.employee_id
  JOIN job_titles jt ON jt.id = e.job_title_id
  JOIN departments d ON d.id = jt.department_id
  JOIN hr_users rq ON rq.id = r.requested_by_hr_user_id
  LEFT JOIN hr_users dc ON dc.id = r.decided_by_hr_user_id
  LEFT JOIN compensation_records cr ON cr.source_request_id = r.id`;

const STORED_RECORD_SELECT = `SELECT c.*, hu.display_name AS changed_by_name, hu.email AS changed_by_email, sr.public_id AS source_public_id
  FROM compensation_records c
  LEFT JOIN hr_users hu ON hu.id = c.changed_by_hr_user_id
  LEFT JOIN compensation_change_requests sr ON sr.id = c.source_request_id`;

export function createSalaryAdjustmentService({ pool, clock = () => new Date(), previewTokens }: {
  pool: Pool;
  clock?: () => Date;
  previewTokens: PreviewTokens;
}): SalaryAdjustmentService {
  /** One READ COMMITTED transaction on a dedicated connection. */
  async function withTransaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
    try {
      // Each statement sees the latest committed rows, so reads after the
      // employee lock see every change committed before the lock was granted.
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      try {
        const result = await fn(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw mapDatabaseError(error);
      }
    } finally {
      connection.release();
    }
  }

  function mapDatabaseError(error: unknown): unknown {
    if (errorCode(error) !== 'ER_DUP_ENTRY' || !(error instanceof Error)) return error;
    if (/uk_ccr_one_pending/.test(error.message)) return new SalaryAdjustmentError('PENDING_REQUEST_EXISTS');
    if (/uk_compensation_operation_key|uk_ccr_request_key|uk_ccr_decision_key/.test(error.message)) return new SalaryAdjustmentError('DUPLICATE_OPERATION');
    if (/uk_compensation_employee_version/.test(error.message)) return new SalaryAdjustmentError('STALE_VERSION');
    return error;
  }

  async function findEmployee(db: Db, principal: Principal, employeeCode: string): Promise<EmployeeRow> {
    if (!EMPLOYEE_CODE.test(employeeCode)) throw new SalaryAdjustmentError('NOT_FOUND', { message: EMPLOYEE_NOT_FOUND });
    const [employee] = await selectRows<EmployeeRow>(db, `${EMPLOYEE_SELECT} WHERE e.employee_code = ?`, [employeeCode]);
    // Unknown and out-of-scope employees get the same error.
    if (employee === undefined || !canAccessEmployee(principal, { country_code: employee.country_code, department: employee.department })) {
      throw new SalaryAdjustmentError('NOT_FOUND', { message: EMPLOYEE_NOT_FOUND });
    }
    return employee;
  }

  /** Locks the employee row. Every compensation write takes this lock first. */
  async function lockEmployee(connection: PoolConnection, employeeId: number): Promise<void> {
    await connection.query('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
  }

  async function loadContext(db: Db, employee: EmployeeRow, today: string): Promise<CompensationContext> {
    const records = await selectRows<RecordRow>(
      db,
      `SELECT id, version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from, change_reason
       FROM compensation_records WHERE employee_id = ? ORDER BY version`,
      [employee.id],
    );
    const byLatest = (a: RecordRow, b: RecordRow) => b.effective_from.localeCompare(a.effective_from) || b.version - a.version;
    const byEarliest = (a: RecordRow, b: RecordRow) => a.effective_from.localeCompare(b.effective_from) || b.version - a.version;
    const future = records.filter((r) => r.effective_from > today);
    // Same selection rules as the directory: current = latest on or before
    // today; a joiner's compensation = earliest future record. Same date:
    // the higher version wins.
    const baseline = employee.employment_status === 'CURRENTLY_WORKING'
      ? records.filter((r) => r.effective_from <= today).sort(byLatest)[0] ?? null
      : employee.employment_status === 'SOON_TO_JOIN' ? [...future].sort(byEarliest)[0] ?? null : null;
    const futureChange = future.filter((r) => r.change_reason !== 'INITIAL_IMPORT').sort(byEarliest)[0] ?? null;
    let band: SalaryBand | null = null;
    if (baseline !== null) {
      const [row] = await selectRows<BandRow>(
        db,
        'SELECT * FROM salary_bands WHERE job_title_id = ? AND country_code = ? AND currency = ?',
        [employee.job_title_id, employee.country_code, baseline.currency],
      );
      band = row === undefined ? null : {
        currency: row.currency,
        minAnnualBaseSalary: row.min_annual_base_salary,
        maxAnnualBaseSalary: row.max_annual_base_salary,
        maxAnnualBonus: row.max_annual_bonus,
        minPercentageIncrease: row.min_percentage_increase,
        maxPercentageIncrease: row.max_percentage_increase,
        minPercentageDecrease: row.min_percentage_decrease,
        maxPercentageDecrease: row.max_percentage_decrease,
      };
    }
    return {
      employee,
      records,
      maxVersion: Math.max(0, ...records.map((r) => r.version)),
      baseline,
      state: employee.employment_status === 'SOON_TO_JOIN' ? 'UPCOMING' : 'CURRENT',
      futureChange,
      band,
    };
  }

  /** Eligibility: CURRENTLY_WORKING or SOON_TO_JOIN with a compensation record to adjust. */
  function requireEligible(context: CompensationContext): RecordRow {
    if (context.employee.employment_status === 'LEFT' || context.baseline === null) throw new SalaryAdjustmentError('EMPLOYEE_INELIGIBLE');
    return context.baseline;
  }

  /** Date, note, and band checks, then the exact plan. Writes nothing. */
  function validate(context: CompensationContext, command: AdjustmentCommand, today: string): AdjustmentPlan {
    const baseline = requireEligible(context);
    if (command.reason === 'CORRECTION' && command.note === null) {
      throw new SalaryAdjustmentError('VALIDATION_ERROR', { reason: 'NOTE_REQUIRED', message: 'A note is required for a correction.' });
    }
    if (command.effectiveFrom < today) {
      throw new SalaryAdjustmentError('VALIDATION_ERROR', { reason: 'PAST_EFFECTIVE_DATE', message: 'The effective date must be today or later.' });
    }
    if (command.effectiveFrom < baseline.effective_from) {
      throw new SalaryAdjustmentError('VALIDATION_ERROR', {
        reason: 'EFFECTIVE_BEFORE_CURRENT',
        message: `The effective date must be on or after ${baseline.effective_from}, when the current compensation takes effect.`,
      });
    }
    if (command.effectiveFrom > today && context.futureChange !== null) {
      throw new SalaryAdjustmentError('VALIDATION_ERROR', {
        reason: 'FUTURE_CHANGE_EXISTS',
        message: `This employee already has an approved change effective ${context.futureChange.effective_from}. Only one future change is allowed.`,
      });
    }
    if (context.band === null) {
      throw new SalaryAdjustmentError('VALIDATION_ERROR', { reason: 'SALARY_BAND', message: 'No salary band is configured for this job title and country.' });
    }
    try {
      return planAdjustment({
        current: { annualBaseSalary: baseline.annual_base_salary, annualBonus: baseline.annual_bonus, currency: baseline.currency },
        band: context.band,
        target: command.target as AdjustmentTarget,
        method: command.method as AdjustmentMethod,
        value: command.value,
      });
    } catch (error) {
      return rejectAdjustment(error);
    }
  }

  /** The normalized command. `value` defaults to the raw input; pass the plan's normalized value once known. */
  function toCommand(input: SalaryAdjustmentCommand, value: string = input.value): AdjustmentCommand {
    return {
      target: input.target,
      method: input.method,
      value,
      effectiveFrom: input.effectiveFrom,
      reason: input.reason,
      note: normalizeNote(input.note),
    };
  }

  async function pendingRequestId(db: Db, employeeId: number): Promise<string | null> {
    const [row] = await selectRows<RowDataPacket & { public_id: string }>(
      db, "SELECT public_id FROM compensation_change_requests WHERE employee_id = ? AND status = 'PENDING'", [employeeId]);
    return row?.public_id ?? null;
  }

  const employeeView = (e: EmployeeRow | RequestViewRow) => ({
    employeeCode: e.employee_code,
    name: fullName(e),
    email: e.email,
    department: e.department,
    jobTitle: e.job_title,
    level: e.level,
    country: e.country_code,
    employmentStatus: e.employment_status,
  });

  // -------------------------------------------------------------------------
  // Preview

  async function preview(principal: Principal, employeeCode: string, input: SalaryAdjustmentCommand): Promise<SalaryAdjustmentPreview> {
    const today = isoDate(clock());
    const employee = await findEmployee(pool, principal, employeeCode);
    const context = await loadContext(pool, employee, today);
    const baseline = requireEligible(context);
    const pending = await pendingRequestId(pool, employee.id);
    const mode: ConfirmationMode = principal.role === 'ADMIN' ? 'DIRECT_APPLY' : 'SUBMIT_REQUEST';
    if (mode === 'SUBMIT_REQUEST' && pending !== null) throw new SalaryAdjustmentError('PENDING_REQUEST_EXISTS');
    const plan = validate(context, toCommand(input), today);
    const command = toCommand(input, plan.value);
    const { token, expiresAt } = await previewTokens.sign({
      actorHrUserId: principal.hrUserId,
      sessionId: principal.sessionId,
      employeeCode: employee.employee_code,
      confirmationMode: mode,
      expectedCompensationVersion: context.maxVersion,
      baseCompensationVersion: baseline.version,
      command,
      proposed: { annualBaseSalary: plan.proposed.annualBaseSalary, annualBonus: plan.proposed.annualBonus },
    });
    const band = context.band as SalaryBand; // validate() rejects a missing band
    const future = context.futureChange;
    return {
      employee: employeeView(employee),
      adjustment: {
        target: plan.target,
        method: plan.method,
        value: plan.value,
        effectiveFrom: command.effectiveFrom,
        reason: input.reason,
        note: command.note,
      },
      currency: plan.currency,
      current: {
        compensationVersion: baseline.version,
        state: context.state,
        effectiveFrom: baseline.effective_from,
        ...plan.current,
      },
      proposed: plan.proposed,
      change: plan.change,
      salaryBand: band,
      validation: { valid: true },
      warnings: {
        futureChange: future === null ? null : {
          effectiveFrom: future.effective_from,
          annualBaseSalary: future.annual_base_salary,
          annualBonus: future.annual_bonus,
          message: `An approved change effective ${future.effective_from} will still take effect with its scheduled amounts.`,
        },
        pendingRequestWillBecomeStale: mode === 'DIRECT_APPLY' && pending !== null,
      },
      expectedCompensationVersion: context.maxVersion,
      confirmationMode: mode,
      previewToken: token,
      previewExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verifies the token and that it matches this exact command and the
   * current compensation state. Must run under the employee lock.
   */
  async function confirmPreview(
    principal: Principal,
    context: CompensationContext,
    previewToken: string,
    input: SalaryAdjustmentCommand,
    mode: ConfirmationMode,
    today: string,
  ): Promise<{ plan: AdjustmentPlan; command: AdjustmentCommand; baseline: RecordRow; versions: { expectedCompensationVersion: number; baseCompensationVersion: number } }> {
    let verified;
    try {
      verified = await previewTokens.verify(previewToken, {
        actorHrUserId: principal.hrUserId,
        sessionId: principal.sessionId,
        employeeCode: context.employee.employee_code,
        confirmationMode: mode,
      });
    } catch (error) {
      if (error instanceof PreviewTokenError) throw new SalaryAdjustmentError('VALIDATION_ERROR', { reason: error.reason, message: error.message });
      throw error;
    }
    const baseline = requireEligible(context);
    if (verified.expectedCompensationVersion !== context.maxVersion || verified.baseCompensationVersion !== baseline.version) {
      throw new SalaryAdjustmentError('STALE_VERSION');
    }
    const plan = validate(context, toCommand(input), today);
    const command = toCommand(input, plan.value);
    const digest = commandDigest({
      actorHrUserId: principal.hrUserId,
      sessionId: principal.sessionId,
      employeeCode: context.employee.employee_code,
      confirmationMode: mode,
      expectedCompensationVersion: context.maxVersion,
      baseCompensationVersion: baseline.version,
      command,
      proposed: { annualBaseSalary: plan.proposed.annualBaseSalary, annualBonus: plan.proposed.annualBonus },
    });
    if (digest !== verified.digest) {
      throw new SalaryAdjustmentError('VALIDATION_ERROR', { reason: 'PREVIEW_MISMATCH', message: 'The change does not match the preview. Request a new preview.' });
    }
    return { plan, command, baseline, versions: verified };
  }

  // -------------------------------------------------------------------------
  // Compensation writes

  async function insertRecord(connection: PoolConnection, values: {
    employeeId: number; version: number; plan: { proposed: { annualBaseSalary: string; annualBonus: string } }; baseline: RecordRow;
    effectiveFrom: string; reason: string; note: string | null; actorHrUserId: number; sourceRequestId: number | null; idempotencyKey: string; now: Date;
    /** Direct changes only; null for an approved request. */
    fingerprint: string | null;
  }): Promise<number> {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO compensation_records (employee_id, version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from,
                                         change_reason, created_at, previous_compensation_record_id, changed_by_hr_user_id,
                                         source_request_id, change_note, operation_idempotency_key, operation_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        values.employeeId, values.version, values.plan.proposed.annualBaseSalary, values.plan.proposed.annualBonus,
        values.baseline.currency, values.baseline.pay_frequency, values.effectiveFrom, values.reason, values.now,
        values.baseline.id, values.actorHrUserId, values.sourceRequestId, values.note, values.idempotencyKey, values.fingerprint,
      ],
    );
    return result.insertId;
  }

  /** Every other pending request for this employee was made against an older version. */
  async function staleOtherPending(connection: PoolConnection, employeeId: number, exceptRequestId: number | null, now: Date): Promise<void> {
    await connection.query(
      `UPDATE compensation_change_requests SET status = 'STALE', decision_note = ?, decided_at = ?, updated_at = ?
       WHERE employee_id = ? AND status = 'PENDING' AND id <> ?`,
      [STALE_REASONS.VERSION, now, now, employeeId, exceptRequestId ?? 0],
    );
  }

  async function recordView(db: Db, recordId: number): Promise<CompensationRecordView> {
    const [row] = await selectRows<StoredRecordRow>(db, `${STORED_RECORD_SELECT} WHERE c.id = ?`, [recordId]);
    if (row === undefined) throw new Error('compensation record not found after write');
    return {
      version: row.version,
      annualBaseSalary: row.annual_base_salary,
      annualBonus: row.annual_bonus,
      annualCashCompensation: addMoney(row.annual_base_salary, row.annual_bonus),
      currency: row.currency,
      payFrequency: row.pay_frequency,
      effectiveFrom: row.effective_from,
      changeReason: row.change_reason,
      changeNote: row.change_note,
      changedBy: row.changed_by_name === null || row.changed_by_email === null ? null : { displayName: row.changed_by_name, email: row.changed_by_email },
      sourceRequestId: row.source_public_id,
      recordedAt: toIso(row.created_at),
    };
  }

  /**
   * The canonical fingerprint of a direct command (review fix 09a). The two
   * versions come from the verified preview token, so a replay of the same
   * confirmation produces the same fingerprint after compensation has moved on.
   */
  function directFingerprint(employeeCode: string, command: AdjustmentCommand, versions: { expectedCompensationVersion: number; baseCompensationVersion: number }): string {
    return directCommandFingerprint({
      employeeCode,
      target: command.target,
      method: command.method,
      value: command.value,
      effectiveFrom: command.effectiveFrom,
      reason: command.reason,
      note: command.note,
      expectedCompensationVersion: versions.expectedCompensationVersion,
      baseCompensationVersion: versions.baseCompensationVersion,
      confirmationMode: 'DIRECT_APPLY',
    });
  }

  async function applyDirect(
    principal: Principal,
    employeeCode: string,
    { previewToken, adjustment }: { previewToken: string; adjustment: SalaryAdjustmentCommand },
    idempotencyKey: string,
  ): Promise<Replayable<SalaryAdjustmentResult>> {
    if (principal.role !== 'ADMIN') throw new SalaryAdjustmentError('FORBIDDEN');
    const now = clock();
    const today = isoDate(now);
    return withTransaction(async (connection) => {
      const employee = await findEmployee(connection, principal, employeeCode);
      await lockEmployee(connection, employee.id);

      const [stored] = await selectRows<StoredRecordRow>(
        connection, `${STORED_RECORD_SELECT} WHERE c.changed_by_hr_user_id = ? AND c.operation_idempotency_key = ?`, [principal.hrUserId, idempotencyKey]);
      if (stored !== undefined) {
        // Same actor and key: replay only for the same command (compared by
        // fingerprint, not by outcome). The token is checked for authenticity
        // but not expiry: the original confirmation already passed in full.
        let versions;
        try {
          versions = await previewTokens.verifyIgnoringExpiry(previewToken, {
            actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, employeeCode: employee.employee_code, confirmationMode: 'DIRECT_APPLY',
          });
        } catch (error) {
          if (error instanceof PreviewTokenError) throw new SalaryAdjustmentError('DUPLICATE_OPERATION');
          throw error;
        }
        const fingerprint = directFingerprint(employee.employee_code, toCommand(adjustment, normalizedValue(adjustment)), versions);
        if (stored.employee_id !== employee.id || stored.source_request_id !== null || stored.operation_fingerprint !== fingerprint) {
          throw new SalaryAdjustmentError('DUPLICATE_OPERATION');
        }
        return { value: { employeeCode: employee.employee_code, compensation: await recordView(connection, stored.id) }, replayed: true };
      }

      const context = await loadContext(connection, employee, today);
      const { plan, command, baseline, versions } = await confirmPreview(principal, context, previewToken, adjustment, 'DIRECT_APPLY', today);
      const recordId = await insertRecord(connection, {
        employeeId: employee.id, version: context.maxVersion + 1, plan, baseline, effectiveFrom: command.effectiveFrom,
        reason: command.reason, note: command.note, actorHrUserId: principal.hrUserId, sourceRequestId: null, idempotencyKey, now,
        fingerprint: directFingerprint(employee.employee_code, command, versions),
      });
      await staleOtherPending(connection, employee.id, null, now);
      return { value: { employeeCode: employee.employee_code, compensation: await recordView(connection, recordId) }, replayed: false };
    });
  }

  /** The command's value normalized as the plan normalizes it (amounts to two decimals). */
  function normalizedValue(input: SalaryAdjustmentCommand): string {
    if (isPercentageMethod(input.method)) return input.value;
    try {
      return normalizeAmountInput(input.value);
    } catch {
      return input.value;
    }
  }

  // -------------------------------------------------------------------------
  // Requests

  function requestView(row: RequestViewRow): SalaryRequestView {
    return {
      requestId: row.public_id,
      status: row.status,
      employee: employeeView(row),
      requestedBy: { displayName: row.requester_name, email: row.requester_email },
      adjustment: {
        target: row.adjustment_target,
        method: row.adjustment_method,
        value: storedValue(row.adjustment_method, row.input_value),
        currency: row.currency,
        previousValue: row.previous_target_value,
        proposedValue: row.proposed_target_value,
        effectiveFrom: row.effective_from,
        reason: row.change_reason,
        note: row.note,
      },
      requestedAgainstVersion: row.requested_against_version,
      createdAt: toIso(row.created_at),
      decidedBy: row.decider_name === null || row.decider_email === null ? null : { displayName: row.decider_name, email: row.decider_email },
      decidedAt: row.decided_at === null ? null : toIso(row.decided_at),
      decisionNote: row.decision_note,
      resultingCompensationVersion: row.resulting_version,
    };
  }

  async function loadRequestView(db: Db, requestRowId: number): Promise<SalaryRequestView> {
    const [row] = await selectRows<RequestViewRow>(db, `${REQUEST_VIEW_SELECT} WHERE r.id = ?`, [requestRowId]);
    if (row === undefined) throw new Error('request not found after write');
    return requestView(row);
  }

  const sameRequestCommand = (row: RequestRow, employeeId: number, command: AdjustmentCommand): boolean =>
    row.employee_id === employeeId
    && row.adjustment_target === command.target
    && row.adjustment_method === command.method
    && storedValue(row.adjustment_method, row.input_value) === command.value
    && row.effective_from === command.effectiveFrom
    && row.change_reason === command.reason
    && row.note === command.note;

  async function submitRequest(
    principal: Principal,
    employeeCode: string,
    { previewToken, adjustment }: { previewToken: string; adjustment: SalaryAdjustmentCommand },
    idempotencyKey: string,
  ): Promise<Replayable<SalaryRequestView>> {
    // Admin HR applies directly; requests are the Scoped HR path.
    if (principal.role !== 'SCOPED') throw new SalaryAdjustmentError('FORBIDDEN');
    const now = clock();
    const today = isoDate(now);
    return withTransaction(async (connection) => {
      const employee = await findEmployee(connection, principal, employeeCode);
      await lockEmployee(connection, employee.id);

      const [existing] = await selectRows<RequestRow>(
        connection, 'SELECT * FROM compensation_change_requests WHERE requested_by_hr_user_id = ? AND request_idempotency_key = ?',
        [principal.hrUserId, idempotencyKey]);
      if (existing !== undefined) {
        const command = toCommand(adjustment, normalizedValue(adjustment));
        if (!sameRequestCommand(existing, employee.id, command)) throw new SalaryAdjustmentError('DUPLICATE_OPERATION');
        return { value: await loadRequestView(connection, existing.id), replayed: true };
      }

      const context = await loadContext(connection, employee, today);
      if (await pendingRequestId(connection, employee.id) !== null) throw new SalaryAdjustmentError('PENDING_REQUEST_EXISTS');
      const { plan, command, baseline } = await confirmPreview(principal, context, previewToken, adjustment, 'SUBMIT_REQUEST', today);
      const [result] = await connection.query<ResultSetHeader>(
        `INSERT INTO compensation_change_requests
           (public_id, employee_id, requested_by_hr_user_id, adjustment_target, adjustment_method, input_value, currency,
            previous_target_value, proposed_target_value, requested_against_version, base_compensation_version,
            effective_from, change_reason, note, request_idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), employee.id, principal.hrUserId, plan.target, plan.method,
          isPercentageMethod(plan.method) ? `${plan.value}.00` : plan.value, plan.currency,
          plan.previousTargetValue, plan.proposedTargetValue, context.maxVersion, baseline.version,
          command.effectiveFrom, command.reason, command.note, idempotencyKey, now, now,
        ],
      );
      return { value: await loadRequestView(connection, result.insertId), replayed: false };
    });
  }

  async function listRequests(principal: Principal, query: SalaryRequestListQuery): Promise<SalaryRequestList> {
    if (query.department !== undefined && principal.role !== 'ADMIN') {
      throw new SalaryAdjustmentError('VALIDATION_ERROR', { message: 'The department filter is available to Admin HR only.' });
    }
    const scope = scopeCondition(principal);
    const parts = [scope];
    if (query.q !== undefined) parts.push(searchCondition(query.q));
    if (query.department !== undefined) parts.push({ sql: 'd.name = ?', params: [query.department] });
    if (query.status !== undefined) parts.push({ sql: 'r.status = ?', params: [query.status] });
    const where = parts.map((p) => p.sql).join(' AND ');
    const params = parts.flatMap((p) => p.params);
    // Allowlisted: the only sort is the creation time; the record ID breaks ties.
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const rows = await selectRows<RequestViewRow>(
      pool,
      `${REQUEST_VIEW_SELECT} WHERE ${where} ORDER BY r.created_at ${direction}, r.id ${direction} LIMIT ? OFFSET ?`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const [count] = await selectRows<CountRow>(
      pool,
      `SELECT COUNT(*) AS n FROM compensation_change_requests r JOIN employees e ON e.id = r.employee_id
       JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id WHERE ${where}`,
      params,
    );
    const totalRows = Number(count?.n ?? 0);
    return {
      requests: rows.map(requestView),
      page: { number: query.page, size: query.pageSize, totalRows, totalPages: Math.ceil(totalRows / query.pageSize) },
    };
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  async function getRequest(principal: Principal, requestId: string): Promise<SalaryRequestView> {
    if (!UUID.test(requestId)) throw new SalaryAdjustmentError('NOT_FOUND', { message: REQUEST_NOT_FOUND });
    const [row] = await selectRows<RequestViewRow>(pool, `${REQUEST_VIEW_SELECT} WHERE r.public_id = ?`, [requestId]);
    // Requests are visible by the employee's place in the caller's current scope.
    if (row === undefined || !canAccessEmployee(principal, { country_code: row.country_code, department: row.department })) {
      throw new SalaryAdjustmentError('NOT_FOUND', { message: REQUEST_NOT_FOUND });
    }
    return requestView(row);
  }

  /** Request row and its employee, locked employee first, then request. */
  async function lockRequest(connection: PoolConnection, requestId: string): Promise<RequestRow> {
    if (!UUID.test(requestId)) throw new SalaryAdjustmentError('NOT_FOUND', { message: REQUEST_NOT_FOUND });
    const [unlocked] = await selectRows<RequestRow>(connection, 'SELECT id, employee_id FROM compensation_change_requests WHERE public_id = ?', [requestId]);
    if (unlocked === undefined) throw new SalaryAdjustmentError('NOT_FOUND', { message: REQUEST_NOT_FOUND });
    await lockEmployee(connection, unlocked.employee_id);
    const [row] = await selectRows<RequestRow>(connection, 'SELECT * FROM compensation_change_requests WHERE id = ? FOR UPDATE', [unlocked.id]);
    if (row === undefined) throw new SalaryAdjustmentError('NOT_FOUND', { message: REQUEST_NOT_FOUND });
    return row;
  }

  /** A previous decision with this Admin's key, if any. */
  async function priorDecision(connection: PoolConnection, principal: Principal, idempotencyKey: string): Promise<RequestRow | undefined> {
    const [row] = await selectRows<RequestRow>(
      connection, 'SELECT * FROM compensation_change_requests WHERE decided_by_hr_user_id = ? AND decision_idempotency_key = ?',
      [principal.hrUserId, idempotencyKey]);
    return row;
  }

  type Recheck = { kind: 'ok'; plan: AdjustmentPlan; context: CompensationContext; baseline: RecordRow } | { kind: 'stale'; reason: string; ineligible: boolean };

  /** Approval revalidation: requester, scope, eligibility, version, date, future change, band. */
  async function recheck(connection: PoolConnection, request: RequestRow, today: string): Promise<Recheck> {
    const stale = (reason: string, ineligible = false): Recheck => ({ kind: 'stale', reason, ineligible });
    let requester;
    try {
      requester = await loadHrUserState(connection, request.requested_by_hr_user_id);
    } catch (error) {
      if (error instanceof AccessError) return stale(STALE_REASONS.REQUESTER_INACTIVE);
      throw error;
    }
    if (requester.status !== 'ACTIVE') return stale(STALE_REASONS.REQUESTER_INACTIVE);
    const [employee] = await selectRows<EmployeeRow>(connection, `${EMPLOYEE_SELECT} WHERE e.id = ?`, [request.employee_id]);
    if (employee === undefined) return stale(STALE_REASONS.INELIGIBLE, true);
    if (!canAccessEmployee(requester, { country_code: employee.country_code, department: employee.department })) {
      return stale(STALE_REASONS.REQUESTER_SCOPE);
    }
    const context = await loadContext(connection, employee, today);
    if (employee.employment_status === 'LEFT' || context.baseline === null) return stale(STALE_REASONS.INELIGIBLE, true);
    if (context.maxVersion !== request.requested_against_version || context.baseline.version !== request.base_compensation_version) {
      return stale(STALE_REASONS.VERSION);
    }
    if (request.effective_from < today) return stale(STALE_REASONS.DATE_PASSED);
    if (request.effective_from > today && context.futureChange !== null) return stale(STALE_REASONS.FUTURE_CONFLICT);
    if (context.band === null) return stale(STALE_REASONS.BAND);
    let plan: AdjustmentPlan;
    try {
      plan = planAdjustment({
        current: { annualBaseSalary: context.baseline.annual_base_salary, annualBonus: context.baseline.annual_bonus, currency: context.baseline.currency },
        band: context.band,
        target: request.adjustment_target,
        method: request.adjustment_method,
        value: storedValue(request.adjustment_method, request.input_value),
      });
    } catch (error) {
      if (error instanceof AdjustmentError) return stale(STALE_REASONS.BAND);
      throw error;
    }
    if (plan.proposedTargetValue !== request.proposed_target_value || plan.previousTargetValue !== request.previous_target_value) {
      return stale(STALE_REASONS.VERSION);
    }
    return { kind: 'ok', plan, context, baseline: context.baseline };
  }

  async function approve(principal: Principal, requestId: string, idempotencyKey: string): Promise<Replayable<SalaryRequestApproval>> {
    if (principal.role !== 'ADMIN') throw new SalaryAdjustmentError('FORBIDDEN');
    const now = clock();
    const today = isoDate(now);
    const outcome = await withTransaction(async (connection) => {
      const request = await lockRequest(connection, requestId);
      const prior = await priorDecision(connection, principal, idempotencyKey);
      if (prior !== undefined) {
        if (prior.id !== request.id || prior.status !== 'APPROVED') throw new SalaryAdjustmentError('DUPLICATE_OPERATION');
        const [record] = await selectRows<IdRow>(connection, 'SELECT id FROM compensation_records WHERE source_request_id = ?', [request.id]);
        if (record === undefined) throw new Error('approved request without a compensation record');
        return { kind: 'done' as const, value: { request: await loadRequestView(connection, request.id), compensation: await recordView(connection, record.id) }, replayed: true };
      }
      if (request.status !== 'PENDING') throw new SalaryAdjustmentError('REQUEST_NOT_PENDING');

      const check = await recheck(connection, request, today);
      if (check.kind === 'stale') {
        // Changed system state: record it, commit, then report the failure.
        await connection.query(
          "UPDATE compensation_change_requests SET status = 'STALE', decision_note = ?, decided_at = ?, updated_at = ? WHERE id = ?",
          [check.reason, now, now, request.id],
        );
        return { kind: 'stale' as const, reason: check.reason, ineligible: check.ineligible };
      }

      const recordId = await insertRecord(connection, {
        employeeId: request.employee_id, version: check.context.maxVersion + 1, plan: check.plan, baseline: check.baseline,
        effectiveFrom: request.effective_from, reason: request.change_reason, note: request.note,
        actorHrUserId: principal.hrUserId, sourceRequestId: request.id, idempotencyKey, now, fingerprint: null,
      });
      await connection.query(
        `UPDATE compensation_change_requests SET status = 'APPROVED', decided_by_hr_user_id = ?, decided_at = ?,
                decision_idempotency_key = ?, updated_at = ? WHERE id = ?`,
        [principal.hrUserId, now, idempotencyKey, now, request.id],
      );
      await staleOtherPending(connection, request.employee_id, request.id, now);
      return { kind: 'done' as const, value: { request: await loadRequestView(connection, request.id), compensation: await recordView(connection, recordId) }, replayed: false };
    });
    if (outcome.kind === 'stale') {
      if (outcome.ineligible) throw new SalaryAdjustmentError('EMPLOYEE_INELIGIBLE');
      throw new SalaryAdjustmentError('STALE_VERSION', { message: `The request can no longer be applied and was marked stale: ${outcome.reason}` });
    }
    return { value: outcome.value, replayed: outcome.replayed };
  }

  async function cancel(principal: Principal, requestId: string, rawNote: string, idempotencyKey: string): Promise<Replayable<SalaryRequestView>> {
    if (principal.role !== 'ADMIN') throw new SalaryAdjustmentError('FORBIDDEN');
    const note = normalizeNote(rawNote);
    if (note === null) throw new SalaryAdjustmentError('VALIDATION_ERROR', { reason: 'NOTE_REQUIRED', message: 'A note is required to cancel a request.' });
    const now = clock();
    return withTransaction(async (connection) => {
      const request = await lockRequest(connection, requestId);
      const prior = await priorDecision(connection, principal, idempotencyKey);
      if (prior !== undefined) {
        if (prior.id !== request.id || prior.status !== 'CANCELLED' || prior.decision_note !== note) throw new SalaryAdjustmentError('DUPLICATE_OPERATION');
        return { value: await loadRequestView(connection, request.id), replayed: true };
      }
      if (request.status !== 'PENDING') throw new SalaryAdjustmentError('REQUEST_NOT_PENDING');
      await connection.query(
        `UPDATE compensation_change_requests SET status = 'CANCELLED', decided_by_hr_user_id = ?, decided_at = ?,
                decision_note = ?, decision_idempotency_key = ?, updated_at = ? WHERE id = ?`,
        [principal.hrUserId, now, note, idempotencyKey, now, request.id],
      );
      return { value: await loadRequestView(connection, request.id), replayed: false };
    });
  }

  return { preview, applyDirect, submitRequest, listRequests, getRequest, approve, cancel };
}
