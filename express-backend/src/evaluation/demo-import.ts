// Copies recorded AI data (conversations, messages, traces, model and tool
// calls, reviews, MCP calls) from an evaluation lane into the demo database
// (AI Task 06). Evaluator and operator tooling only: the server never imports
// src/evaluation/.
//
// Guards (fixture-guard.ts): source name ends in _test, target name ends in
// _demo, both repeated on the command line and matched against the connected
// databases, APP_ENV=production refused. Dry run unless `apply`.
//
// Preconditions on the target, checked before any write: migrations 001-008
// applied (on both sides), and the same employee set as the source (count and
// SHA-256 of the sorted employee codes).
//
// HR users are mapped by email, never by ID. A source user missing on the
// target is created INACTIVE Scoped HR with the same scope, a random unusable
// Argon2id hash, and an HR_USER_CREATED audit event whose reason says it was
// imported.
//
// UUIDs, timestamps, and the trace-time scope snapshot are copied exactly.
// Numeric message and model-call IDs are target AUTO_INCREMENT values, so the
// references to them (trace user/final message, tool call parent) are remapped.
// One transaction per conversation; a conversation, trace, or MCP call whose ID
// already exists is skipped, so a second run writes nothing. No salary data,
// employees, or requests are copied.
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { hashPassword } from '../access/passwords.js';
import { assertFixtureTarget } from './fixture-guard.js';
import { FixtureRefusedError } from './fixture-guard.js';

export const REQUIRED_MIGRATIONS = Object.freeze([
  '001_initial_schema.sql', '002_hr_access_control.sql', '003_salary_adjustments.sql', '004_hr_access_management.sql',
  '005_ai_observability.sql', '006_temporary_password_regeneration.sql', '007_ai_trace_actor_scope.sql', '008_ai_trace_summary_index.sql',
]);
export const IMPORT_TABLES = Object.freeze(['ai_conversations', 'ai_messages', 'ai_traces', 'ai_model_calls', 'ai_tool_calls', 'ai_trace_reviews', 'mcp_tool_calls'] as const);
type ImportTable = (typeof IMPORT_TABLES)[number];
const ORACLE_NOTE_PREFIX = 'EVAL-ORACLE-FIXTURE v1';

type Row = RowDataPacket & Record<string, unknown>;
type Db = Pool | PoolConnection;

export interface ImportReport {
  kind: 'acme-demo-ai-import'; mode: 'DRY_RUN' | 'APPLIED'; source: string; target: string;
  tables: Record<ImportTable, { copied: number; skipped: number }>;
  hrUsersCreated: { email: string; displayName: string; countries: string[]; departments: string[] }[];
  hrUsersMapped: number;
  warnings: string[];
}

const rows = async (db: Db, sql: string, params: unknown[] = []): Promise<Row[]> => (await db.query<Row[]>(sql, params))[0];
const emailKey = (email: unknown): string => String(email).trim().toLowerCase();

async function jsonColumns(db: Db): Promise<Map<string, Set<string>>> {
  const found = await rows(db, `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'json' AND TABLE_NAME IN (${IMPORT_TABLES.map(() => '?').join(',')})`, [...IMPORT_TABLES]);
  const map = new Map<string, Set<string>>();
  for (const r of found) {
    const set = map.get(String(r.t)) ?? new Set<string>();
    set.add(String(r.c));
    map.set(String(r.t), set);
  }
  return map;
}

async function checkMigrations(db: Db, side: string): Promise<void> {
  const applied = new Set((await rows(db, 'SELECT name FROM schema_migrations')).map((r) => String(r.name)));
  const missing = REQUIRED_MIGRATIONS.filter((m) => !applied.has(m));
  if (missing.length > 0) throw new FixtureRefusedError(`refusing: the ${side} database is missing migrations ${missing.join(', ')}`);
}

async function employeeFingerprint(db: Db): Promise<{ count: number; sha256: string }> {
  const codes = (await rows(db, 'SELECT employee_code FROM employees ORDER BY employee_code')).map((r) => String(r.employee_code));
  return { count: codes.length, sha256: createHash('sha256').update(codes.join(',')).digest('hex') };
}

async function oracleFixtureCodes(db: Db): Promise<string[]> {
  return (await rows(db, `SELECT DISTINCT e.employee_code FROM compensation_records c JOIN employees e ON e.id = c.employee_id
    WHERE c.change_note LIKE ? ORDER BY e.employee_code`, [`${ORACLE_NOTE_PREFIX}%`])).map((r) => String(r.employee_code));
}

/** INSERT one row with the given values; JSON columns are serialised. */
async function insert(db: PoolConnection, table: string, values: Record<string, unknown>, json: Set<string> | undefined): Promise<number> {
  const columns = Object.keys(values);
  const params = columns.map((c) => {
    const v = values[c];
    return json?.has(c) && v !== null && v !== undefined ? JSON.stringify(v) : v ?? null;
  });
  const [result] = await db.query(`INSERT INTO ${table} (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, params);
  return Number((result as { insertId: number }).insertId);
}
const without = (row: Row, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

export async function importDemoAiData({ source, target, apply, appEnv, sourceDatabase, targetDatabase, confirmSourceDatabase, confirmTargetDatabase, sourceLabel }: {
  source: Pool; target: Pool; apply: boolean; appEnv: unknown;
  sourceDatabase: string; targetDatabase: string; confirmSourceDatabase: unknown; confirmTargetDatabase: unknown;
  /** Shown in the imported users' audit reason. Defaults to the source database name. */
  sourceLabel?: string;
}): Promise<ImportReport> {
  await assertFixtureTarget(source, { appEnv, databaseName: sourceDatabase, confirmDatabase: confirmSourceDatabase, suffixes: ['test'], flag: '--source-database' });
  await assertFixtureTarget(target, { appEnv, databaseName: targetDatabase, confirmDatabase: confirmTargetDatabase, suffixes: ['demo'], flag: '--target-database' });

  await checkMigrations(source, 'source');
  await checkMigrations(target, 'target');
  const [sourceEmployees, targetEmployees] = [await employeeFingerprint(source), await employeeFingerprint(target)];
  if (sourceEmployees.count !== targetEmployees.count || sourceEmployees.sha256 !== targetEmployees.sha256) {
    throw new FixtureRefusedError(`refusing: the target employee set differs from the source (count ${targetEmployees.count} vs ${sourceEmployees.count}, or different employee codes). Seed the target with the same workbook first.`);
  }

  const warnings: string[] = [];
  const [sourceOracle, targetOracle] = [await oracleFixtureCodes(source), await oracleFixtureCodes(target)];
  if (sourceOracle.length > 0 && targetOracle.length === 0) {
    warnings.push('The target has no evaluator oracle fixtures. Run eval:oracle-fixtures --apply on the target first, or answers that cite them will not match.');
  } else if (sourceOracle.length > 0 && sourceOracle.join() !== targetOracle.join()) {
    warnings.push(`The oracle-fixture employees differ (source ${sourceOracle.join(', ') || 'none'}, target ${targetOracle.join(', ') || 'none'}).`);
  }

  // Every source HR user, mapped by email (the copied rows reference some of them).
  const referenced = await rows(source, `SELECT u.id, u.email, u.display_name,
      (SELECT JSON_ARRAYAGG(cs.country_code) FROM hr_user_country_scopes cs WHERE cs.hr_user_id = u.id) AS countries,
      (SELECT JSON_ARRAYAGG(d.name) FROM hr_user_department_scopes ds JOIN departments d ON d.id = ds.department_id WHERE ds.hr_user_id = u.id) AS departments
    FROM hr_users u ORDER BY u.id`);
  const list = (v: unknown): string[] => (typeof v === 'string' ? JSON.parse(v) as string[] : Array.isArray(v) ? v as string[] : []).slice().sort();
  const targetUsers = new Map((await rows(target, 'SELECT id, email FROM hr_users')).map((r) => [emailKey(r.email), Number(r.id)]));
  const userMap = new Map<number, number>();
  const hrUsersCreated: ImportReport['hrUsersCreated'] = [];
  for (const user of referenced) {
    const existing = targetUsers.get(emailKey(user.email));
    if (existing !== undefined) { userMap.set(Number(user.id), existing); continue; }
    const countries = list(user.countries);
    const departments = list(user.departments);
    hrUsersCreated.push({ email: String(user.email), displayName: String(user.display_name), countries, departments });
    if (!apply) { userMap.set(Number(user.id), -1); continue; }
    const connection = await target.getConnection();
    try {
      await connection.beginTransaction();
      // A random secret, hashed and then discarded: nobody can sign in with this account.
      const hash = await hashPassword(randomBytes(32).toString('base64url'));
      const id = await insert(connection, 'hr_users', { email: String(user.email), display_name: String(user.display_name), password_hash: hash, role: 'SCOPED', status: 'INACTIVE' }, undefined);
      for (const code of countries) await connection.query('INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES (?, ?)', [id, code]);
      for (const name of departments) {
        const [found] = await connection.query<Row[]>('SELECT id FROM departments WHERE name = ?', [name]);
        if (!found[0]) throw new FixtureRefusedError(`refusing: department ${name} does not exist on the target`);
        await connection.query('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES (?, ?)', [id, found[0].id]);
      }
      await connection.query(`INSERT INTO access_audit_events (actor_hr_user_id, target_hr_user_id, action, before_state, after_state, reason, resulting_version)
        VALUES (NULL, ?, 'HR_USER_CREATED', NULL, ?, ?, 1)`, [id, JSON.stringify({ displayName: String(user.display_name), role: 'SCOPED', status: 'INACTIVE', countries, departments }),
        `Imported with recorded AI data from ${sourceLabel ?? sourceDatabase} (demo:import-ai-data). Inactive; no usable password.`]);
      await connection.commit();
      userMap.set(Number(user.id), id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
  const mapUser = (id: unknown): number => {
    const mapped = userMap.get(Number(id));
    if (mapped === undefined) throw new FixtureRefusedError('refusing: a copied row references an HR user that could not be mapped');
    return mapped;
  };

  const tables = Object.fromEntries(IMPORT_TABLES.map((t) => [t, { copied: 0, skipped: 0 }])) as ImportReport['tables'];
  const json = await jsonColumns(target);
  const existingConversations = new Set((await rows(target, 'SELECT id FROM ai_conversations')).map((r) => String(r.id)));
  const existingTraces = new Set((await rows(target, 'SELECT id FROM ai_traces')).map((r) => String(r.id)));

  for (const conversation of await rows(source, 'SELECT * FROM ai_conversations ORDER BY created_at, id')) {
    const conversationId = String(conversation.id);
    const [messages, traces, modelCalls, toolCalls, reviews] = await Promise.all([
      rows(source, 'SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY sequence', [conversationId]),
      rows(source, 'SELECT * FROM ai_traces WHERE conversation_id = ? ORDER BY sequence', [conversationId]),
      rows(source, 'SELECT mc.* FROM ai_model_calls mc JOIN ai_traces t ON t.id = mc.trace_id WHERE t.conversation_id = ? ORDER BY mc.trace_id, mc.sequence', [conversationId]),
      rows(source, 'SELECT tc.* FROM ai_tool_calls tc JOIN ai_traces t ON t.id = tc.trace_id WHERE t.conversation_id = ? ORDER BY tc.trace_id, tc.sequence', [conversationId]),
      rows(source, 'SELECT r.* FROM ai_trace_reviews r JOIN ai_traces t ON t.id = r.trace_id WHERE t.conversation_id = ?', [conversationId]),
    ]);
    const counts: [ImportTable, number][] = [['ai_conversations', 1], ['ai_messages', messages.length], ['ai_traces', traces.length], ['ai_model_calls', modelCalls.length], ['ai_tool_calls', toolCalls.length], ['ai_trace_reviews', reviews.length]];
    if (existingConversations.has(conversationId) || traces.some((t) => existingTraces.has(String(t.id)))) {
      for (const [t, n] of counts) tables[t].skipped += n;
      continue;
    }
    if (!apply) {
      for (const [t, n] of counts) tables[t].copied += n;
      continue;
    }
    const connection = await target.getConnection();
    try {
      await connection.beginTransaction();
      await insert(connection, 'ai_conversations', { ...conversation, hr_user_id: mapUser(conversation.hr_user_id) }, json.get('ai_conversations'));
      for (const trace of traces) {
        await insert(connection, 'ai_traces', { ...without(trace, 'user_message_id', 'final_message_id'), hr_user_id: mapUser(trace.hr_user_id) }, json.get('ai_traces'));
      }
      const messageIds = new Map<number, number>();
      for (const message of messages) messageIds.set(Number(message.id), await insert(connection, 'ai_messages', without(message, 'id'), json.get('ai_messages')));
      for (const trace of traces) {
        const user = trace.user_message_id === null ? null : messageIds.get(Number(trace.user_message_id)) ?? null;
        const final = trace.final_message_id === null ? null : messageIds.get(Number(trace.final_message_id)) ?? null;
        await connection.query('UPDATE ai_traces SET user_message_id = ?, final_message_id = ? WHERE id = ?', [user, final, trace.id]);
      }
      const modelIds = new Map<number, number>();
      for (const call of modelCalls) modelIds.set(Number(call.id), await insert(connection, 'ai_model_calls', without(call, 'id'), json.get('ai_model_calls')));
      for (const call of toolCalls) {
        const parent = modelIds.get(Number(call.model_call_id));
        if (parent === undefined) throw new FixtureRefusedError('refusing: a tool call references a model call outside its conversation');
        await insert(connection, 'ai_tool_calls', { ...without(call, 'id'), model_call_id: parent }, json.get('ai_tool_calls'));
      }
      for (const review of reviews) await insert(connection, 'ai_trace_reviews', { ...review, reviewer_hr_user_id: mapUser(review.reviewer_hr_user_id) }, json.get('ai_trace_reviews'));
      await connection.commit();
      for (const [t, n] of counts) tables[t].copied += n;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  const existingMcp = new Set((await rows(target, 'SELECT id FROM mcp_tool_calls')).map((r) => String(r.id)));
  for (const call of await rows(source, 'SELECT * FROM mcp_tool_calls ORDER BY started_at, id')) {
    if (existingMcp.has(String(call.id))) { tables.mcp_tool_calls.skipped += 1; continue; }
    if (apply) {
      const connection = await target.getConnection();
      try { await insert(connection, 'mcp_tool_calls', { ...call, hr_user_id: mapUser(call.hr_user_id) }, json.get('mcp_tool_calls')); } finally { connection.release(); }
    }
    tables.mcp_tool_calls.copied += 1;
  }

  return {
    kind: 'acme-demo-ai-import', mode: apply ? 'APPLIED' : 'DRY_RUN', source: sourceDatabase, target: targetDatabase,
    tables, hrUsersCreated, hrUsersMapped: referenced.length - hrUsersCreated.length, warnings,
  };
}
