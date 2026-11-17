// Database schema artifact, generated from the migration SQL (not from a live database).
//
//   node architecture-viz/schema.ts         (Node 22.18+ strips the types)
//
// Reads express-backend/db/migrations/*.sql in order, applies CREATE TABLE and ALTER TABLE
// (ADD/MODIFY COLUMN, ADD KEY, ADD UNIQUE KEY, ADD CONSTRAINT … FOREIGN KEY / CHECK), and adds
// schema_migrations from the migration runner (src/db/migrate.ts). Writes out/schema.html and
// out/schema.png. Group notes are quoted verbatim from migration comments, located by an anchor
// phrase; nothing is paraphrased.
//
// Checks (the run exits non-zero if any fail): every CREATE TABLE in the migrations is in the
// output and in exactly one group; every group table exists; every foreign key points at a known
// table and column; every note anchor is found.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const migrationsDir = path.join(repoRoot, 'express-backend/db/migrations');
const runnerFile = path.join(repoRoot, 'express-backend/src/db/migrate.ts');
const outDir = path.join(here, 'out');
const BASE = 'master 9236ac4 with AI Task 05 merged (feat/architecture-flows); commit ID not read, no Git in this lane';

type Column = { name: string; type: string; nullable: boolean; generated: boolean; addedIn: string };
type Index = { name: string; columns: string[]; unique: boolean; addedIn: string };
type ForeignKey = { name: string; columns: string[]; table: string; refColumns: string[]; onDelete: string; addedIn: string };
type Check = { name: string; expression: string; addedIn: string };
type Table = { name: string; createdIn: string; primaryKey: string[]; columns: Column[]; indexes: Index[]; foreignKeys: ForeignKey[]; checks: Check[] };

// ------------------------------------------------------------------ SQL parsing

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"' || ch === '`') {
          quote = ch;
        } else if (ch === '-' && line[i + 1] === '-') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

/** Splits on `separator` at paren depth 0 and outside quotes. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const list = (inner: string): string[] => inner.split(',').map((c) => c.replace(/[`\s]/g, '')).filter(Boolean);

function parseColumn(def: string, addedIn: string): Column {
  const match = /^`?(\w+)`?\s+(.*)$/.exec(def);
  if (!match) throw new Error(`cannot parse column: ${def}`);
  const [, name, rest] = match;
  // The type is everything up to the first column attribute.
  const typeEnd = rest.search(/\s(CHARACTER SET|COLLATE|NOT NULL|NULL|DEFAULT|AUTO_INCREMENT|GENERATED|ON UPDATE|AFTER|UNIQUE|COMMENT)\b/);
  let type = (typeEnd === -1 ? rest : rest.slice(0, typeEnd)).trim();
  const enumMatch = /^ENUM\((.*)\)$/i.exec(type);
  if (enumMatch) {
    const values = splitTop(enumMatch[1], ',');
    type = values.join(',').length <= 34 ? `ENUM(${values.join(', ')})` : `ENUM(${values.length} values)`;
  }
  return { name, type, nullable: !/\bNOT NULL\b/.test(rest), generated: /\bGENERATED ALWAYS AS\b/.test(rest), addedIn };
}

function applyItem(table: Table, raw: string, file: string, alter: boolean): void {
  let item = raw;
  if (alter) {
    if (/^ADD COLUMN /i.test(item)) {
      table.columns.push(parseColumn(item.replace(/^ADD COLUMN /i, ''), file));
      return;
    }
    if (/^MODIFY COLUMN /i.test(item)) {
      const column = parseColumn(item.replace(/^MODIFY COLUMN /i, ''), file);
      const existing = table.columns.find((c) => c.name === column.name);
      if (!existing) throw new Error(`${file}: MODIFY of unknown column ${table.name}.${column.name}`);
      Object.assign(existing, { type: column.type, nullable: column.nullable });
      return;
    }
    if (!/^ADD /i.test(item)) throw new Error(`${file}: unsupported ALTER item: ${item.slice(0, 60)}`);
    item = item.replace(/^ADD /i, '');
  }
  let m: RegExpExecArray | null;
  if ((m = /^PRIMARY KEY \(([^)]*)\)/i.exec(item))) {
    table.primaryKey = list(m[1]);
  } else if ((m = /^UNIQUE KEY `?(\w+)`? \(([^)]*)\)/i.exec(item))) {
    table.indexes.push({ name: m[1], columns: list(m[2]), unique: true, addedIn: file });
  } else if ((m = /^(?:KEY|INDEX) `?(\w+)`? \(([^)]*)\)/i.exec(item))) {
    table.indexes.push({ name: m[1], columns: list(m[2]), unique: false, addedIn: file });
  } else if ((m = /^CONSTRAINT `?(\w+)`? FOREIGN KEY \(([^)]*)\) REFERENCES `?(\w+)`? ?\(([^)]*)\)(.*)$/i.exec(item))) {
    const onDelete = /ON DELETE (CASCADE|RESTRICT|SET NULL|NO ACTION)/i.exec(m[5])?.[1].toUpperCase() ?? 'RESTRICT';
    table.foreignKeys.push({ name: m[1], columns: list(m[2]), table: m[3], refColumns: list(m[4]), onDelete, addedIn: file });
  } else if ((m = /^CONSTRAINT `?(\w+)`? CHECK (.*)$/i.exec(item))) {
    table.checks.push({ name: m[1], expression: m[2], addedIn: file });
  } else if (!alter) {
    table.columns.push(parseColumn(item, file));
  } else {
    throw new Error(`${file}: unsupported ALTER ADD item: ${item.slice(0, 60)}`);
  }
}

function parseStatements(sql: string, file: string, tables: Map<string, Table>, created: string[]): void {
  for (const statement of splitTop(stripComments(sql), ';')) {
    let m: RegExpExecArray | null;
    if ((m = /^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`? \((.*)\)[^)]*$/is.exec(statement))) {
      const [, name, body] = m;
      if (tables.has(name)) throw new Error(`${file}: table ${name} created twice`);
      const table: Table = { name, createdIn: file, primaryKey: [], columns: [], indexes: [], foreignKeys: [], checks: [] };
      for (const item of splitTop(body, ',')) applyItem(table, item, file, false);
      tables.set(name, table);
      created.push(name);
    } else if ((m = /^ALTER TABLE `?(\w+)`? (.*)$/is.exec(statement))) {
      const table = tables.get(m[1]);
      if (!table) throw new Error(`${file}: ALTER of unknown table ${m[1]}`);
      for (const item of splitTop(m[2], ',')) applyItem(table, item, file, true);
    } else if (/^(UPDATE|INSERT|DELETE|SET)\b/i.test(statement)) {
      // Data statements do not change the schema.
    } else if (/^(CREATE|ALTER|DROP|RENAME)\b/i.test(statement)) {
      throw new Error(`${file}: unsupported DDL: ${statement.slice(0, 60)}`);
    }
  }
}

// ------------------------------------------------------------------ groups and notes

type NoteSource = { file: string; anchor: string };
type Group = { id: string; title: string; tables: string[]; notes: NoteSource[]; facts?: (t: Map<string, Table>) => string[] };

const GROUPS: Group[] = [
  {
    id: 'people',
    title: 'People and organisation',
    tables: ['employees', 'countries', 'departments', 'job_titles', 'salary_bands'],
    notes: [
      { file: '001_initial_schema.sql', anchor: 'Department and level are reached through job_title_id' },
      { file: '003_salary_adjustments.sql', anchor: 'Product policy: one band per job title, country, and currency' },
    ],
  },
  {
    id: 'compensation',
    title: 'Compensation',
    tables: ['compensation_records', 'compensation_change_requests'],
    notes: [
      { file: '001_initial_schema.sql', anchor: 'Immutable compensation history. annual_base_salary is authoritative' },
      { file: '003_salary_adjustments.sql', anchor: 'Highest compensation version when the request was made' },
      { file: '003_salary_adjustments.sql', anchor: 'the unique key allows one pending request per employee' },
    ],
    facts: (t) => {
      const versioned = t.get('compensation_records')?.indexes.find((i) => i.name === 'uk_compensation_employee_version');
      return versioned ? [`UNIQUE KEY ${versioned.name} (${versioned.columns.join(', ')}): one row per employee and version.`] : [];
    },
  },
  {
    id: 'access',
    title: 'Access',
    tables: ['hr_users', 'hr_user_country_scopes', 'hr_user_department_scopes', 'hr_sessions', 'access_audit_events'],
    notes: [
      { file: '002_hr_access_control.sql', anchor: 'Scope rule: employee country IN countries AND employee department IN departments' },
      { file: '002_hr_access_control.sql', anchor: 'All foreign keys RESTRICT: HR users are deactivated, never' },
      { file: '002_hr_access_control.sql', anchor: 'Append-only access history' },
    ],
  },
  {
    id: 'ai',
    title: 'AI observability',
    tables: ['ai_conversations', 'ai_messages', 'ai_traces', 'ai_model_calls', 'ai_tool_calls', 'ai_trace_reviews', 'mcp_tool_calls'],
    notes: [
      { file: '005_ai_observability.sql', anchor: 'Turn-owned messages cascade with their trace' },
      { file: '007_ai_trace_actor_scope.sql', anchor: "the actor's authorization at trace time" },
      { file: '008_ai_trace_summary_index.sql', anchor: 'This covering index lets' },
    ],
    facts: (t) => {
      const traces = t.get('ai_traces');
      const check = traces?.checks.find((c) => c.name === 'chk_ai_traces_actor_scope');
      const index = traces?.indexes.find((i) => i.name === 'idx_ai_traces_summary');
      return [
        ...(check ? [`CHECK ${check.name} (${check.addedIn}): ${check.expression}`] : []),
        ...(index ? [`KEY ${index.name} (${index.addedIn}): (${index.columns.join(', ')})`] : []),
      ];
    },
  },
  { id: 'runner', title: 'Migration bookkeeping', tables: ['schema_migrations'], notes: [] },
];

/** The whole comment block (consecutive `--` lines) that contains the anchor, verbatim. */
function quote(source: NoteSource): { text: string; where: string } {
  const lines = readFileSync(path.join(migrationsDir, source.file), 'utf8').split('\n');
  const hit = lines.findIndex((line) => /^\s*--/.test(line) && line.includes(source.anchor));
  if (hit === -1) throw new Error(`note anchor not found in ${source.file}: "${source.anchor}"`);
  let start = hit;
  let end = hit;
  while (start > 0 && /^\s*--/.test(lines[start - 1]) && !/^\s*--\s*\d{3}_\w+\.sql\s*$/.test(lines[start - 1])) start -= 1;
  while (end < lines.length - 1 && /^\s*--/.test(lines[end + 1])) end += 1;
  const text = lines
    .slice(start, end + 1)
    .map((l) => l.replace(/^\s*--\s?/, ''))
    .filter((l) => !/^Forward-only\.?$/.test(l.trim()) && !/^\d{3}_\w+\.sql$/.test(l.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, where: `${source.file}:${start + 1}` };
}

// ------------------------------------------------------------------ rendering

const esc = (value: unknown): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function card(table: Table): string {
  const fkByColumn = new Map<string, ForeignKey>();
  for (const fk of table.foreignKeys) if (fk.columns.length === 1) fkByColumn.set(fk.columns[0], fk);
  const uniqueSingle = new Set(table.indexes.filter((i) => i.unique && i.columns.length === 1).map((i) => i.columns[0]));
  const rows = table.columns
    .map((c) => {
      const marks = [
        table.primaryKey.includes(c.name) ? '<span class="mk pk">PK</span>' : '',
        fkByColumn.has(c.name) ? '<span class="mk fk">FK</span>' : '',
        uniqueSingle.has(c.name) ? '<span class="mk uq">UQ</span>' : '',
      ].join('');
      const fk = fkByColumn.get(c.name);
      const link = fk ? `<a class="ref" href="#t-${esc(fk.table)}">→ ${esc(fk.table)}.${esc(fk.refColumns.join(','))}${fk.onDelete !== 'RESTRICT' ? ` <span class="del">${esc(fk.onDelete)}</span>` : ''}</a>` : '';
      return `<tr${c.addedIn !== table.createdIn ? ' class="later"' : ''}>
        <td class="cn">${esc(c.name)}${marks}</td>
        <td class="ct">${esc(c.type)}${c.nullable ? '<span class="null"> null</span>' : ''}${c.generated ? '<span class="null"> generated</span>' : ''}${c.addedIn !== table.createdIn ? `<span class="added"> +${esc(c.addedIn.slice(0, 3))}</span>` : ''}${link ? `<br>${link}` : ''}</td>
      </tr>`;
    })
    .join('');
  const multiFks = table.foreignKeys.filter((fk) => fk.columns.length > 1);
  const indexes = table.indexes
    .map((i) => `<li><span class="mk ${i.unique ? 'uq' : 'ix'}">${i.unique ? 'UNIQUE' : 'KEY'}</span><span class="mono">${esc(i.name)}</span> (${esc(i.columns.join(', '))})${i.addedIn !== table.createdIn ? ` <span class="added">+${esc(i.addedIn.slice(0, 3))}</span>` : ''}</li>`)
    .join('');
  const multi = multiFks.map((fk) => `<li><span class="mk fk">FK</span>(${esc(fk.columns.join(', '))}) <a class="ref" href="#t-${esc(fk.table)}">→ ${esc(fk.table)}(${esc(fk.refColumns.join(', '))})</a></li>`).join('');
  const checks = table.checks.length ? `<div class="checks"><b>${table.checks.length} CHECK</b> ${table.checks.map((c) => `<span class="mono">${esc(c.name.replace(/^chk_/, ''))}</span>`).join(', ')}</div>` : '';
  return `<section class="card" id="t-${esc(table.name)}">
    <h3><span class="mono">${esc(table.name)}</span><span class="src">${esc(table.createdIn)}</span></h3>
    <table class="cols"><tbody>${rows}</tbody></table>
    ${indexes || multi ? `<ul class="idx">${indexes}${multi}</ul>` : ''}
    ${checks}
  </section>`;
}

function page(tables: Map<string, Table>, migrations: string[]): string {
  const groups = GROUPS.map((g) => {
    const notes = g.notes.map(quote).map((n) => `<li>${esc(n.text)} <span class="cite">${esc(n.where)}</span></li>`).join('');
    const facts = (g.facts?.(tables) ?? []).map((f) => `<li class="fact mono">${esc(f)}</li>`).join('');
    const runnerNote = g.id === 'runner' ? '<li>Created by the migration runner (express-backend/src/db/migrate.ts) before it applies the files; one row per applied migration.</li>' : '';
    return `<section class="group" id="g-${g.id}">
      <h2>${esc(g.title)} <span class="count">${g.tables.length} ${g.tables.length === 1 ? 'table' : 'tables'}</span></h2>
      <div class="cards">${g.tables.map((name) => card(tables.get(name)!)).join('')}</div>
      ${notes || facts || runnerNote ? `<ul class="notes">${notes}${facts}${runnerNote}</ul>` : ''}
    </section>`;
  }).join('');
  const fkCount = [...tables.values()].reduce((n, t) => n + t.foreignKeys.length, 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Database schema</title>
<style>
  :root { --ground: #f7f5f1; --ink: #18233a; --muted: #4a5467; --line: #dcd7cd; --surface: #fff; --accent: #2a57c0; --db: #8a5a00; --db-wash: #fbf4e4;
    --sans: "Public Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); font-size: 13px; line-height: 1.4; }
  .page { max-width: 1440px; margin: 0 auto; padding: 32px; }
  header h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
  header p { margin: 0; color: var(--muted); font-size: 15px; max-width: 80ch; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 14px 0 6px; font-size: 12px; color: var(--muted); align-items: center; }
  .group { margin-top: 26px; break-inside: avoid-page; }
  .group h2 { font-size: 16px; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .count { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 6px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 12px; align-items: start; }
  .card { background: var(--surface); border: 1px solid #c9c3b7; border-top: 3px solid var(--db); border-radius: 8px; padding: 8px 10px 10px; break-inside: avoid; }
  .card h3 { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; margin: 0 0 6px; font-size: 13.5px; }
  .src { font-size: 10.5px; font-weight: 400; color: var(--muted); font-family: var(--mono); }
  .mono { font-family: var(--mono); }
  table.cols { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .cols td { border-top: 1px solid #efebe4; padding: 2px 4px 2px 0; vertical-align: top; }
  .cn { font-family: var(--mono); white-space: nowrap; }
  .ct { font-family: var(--mono); color: var(--muted); overflow-wrap: anywhere; }
  .later .cn { color: var(--accent); }
  .null { color: var(--muted); }
  .added { color: var(--accent); font-size: 10px; }
  .mk { display: inline-block; font: 600 9px var(--sans); border-radius: 3px; padding: 0 3px; margin-left: 4px; vertical-align: 1px; }
  .pk { background: var(--ink); color: #fff; } .fk { background: #e6ecf8; color: var(--accent); border: 1px solid #c3d0ec; }
  .uq { background: var(--db-wash); color: var(--db); border: 1px solid #e5cf9f; } .ix { background: #ece8e0; color: var(--muted); }
  ul.idx { list-style: none; margin: 6px 0 0; padding: 6px 0 0; border-top: 1px solid var(--line); font-size: 11px; }
  ul.idx li { margin: 1px 0; overflow-wrap: anywhere; } ul.idx .mk { margin: 0 5px 0 0; }
  .ref { color: var(--accent); text-decoration: none; font-size: 10.5px; } .del { color: #b3261e; font-weight: 600; }
  .checks { margin-top: 5px; font-size: 10.5px; color: var(--muted); overflow-wrap: anywhere; }
  ul.notes { margin: 10px 0 0; padding: 8px 12px 8px 26px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; font-size: 12.5px; }
  ul.notes li { margin: 3px 0; } .cite { color: var(--muted); font-family: var(--mono); font-size: 10.5px; }
  .fact { font-size: 11px; color: var(--ink); overflow-wrap: anywhere; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
  footer ol { margin: 6px 0; padding-left: 20px; columns: 2; } footer p { margin: 4px 0; }
  @media print { html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { padding: 10px; } }
</style>
</head>
<body><div class="page">
  <header>
    <h1>Database schema</h1>
    <p>${tables.size} tables and ${fkCount} foreign keys, generated from the ${migrations.length} migration files (and the migration runner's own table), not from a live database.</p>
  </header>
  <div class="legend">
    <span><span class="mk pk">PK</span> primary key</span><span><span class="mk fk">FK</span> foreign key (→ target)</span><span><span class="mk uq">UQ</span> unique</span>
    <span><span class="mk ix">KEY</span> index</span><span><span class="null">null</span> nullable</span><span><span class="added">+003</span> added by a later migration</span><span><span class="del">CASCADE</span> / <span class="del">SET NULL</span> non-RESTRICT delete rule</span>
  </div>
  ${groups}
  <footer>
    <p>Migrations parsed, in order:</p>
    <ol>${migrations.map((m) => `<li class="mono">${esc(m)}</li>`).join('')}</ol>
    <p>Traced at ${esc(BASE)}. Generated by architecture-viz/schema.ts from express-backend/db/migrations/.</p>
  </footer>
</div></body></html>
`;
}

// ------------------------------------------------------------------ main

const migrations = readdirSync(migrationsDir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const tables = new Map<string, Table>();
const created: string[] = [];
for (const file of migrations) parseStatements(readFileSync(path.join(migrationsDir, file), 'utf8'), file, tables, created);
const runnerSql = /`(CREATE TABLE IF NOT EXISTS schema_migrations[\s\S]*?)`/.exec(readFileSync(runnerFile, 'utf8'))?.[1];
if (!runnerSql) throw new Error('schema_migrations CREATE TABLE not found in migrate.ts');
parseStatements(runnerSql, 'migrate.ts', tables, created);

const problems: string[] = [];
const grouped = GROUPS.flatMap((g) => g.tables);
for (const name of created) {
  const count = grouped.filter((t) => t === name).length;
  if (count !== 1) problems.push(`table ${name} (CREATE TABLE in ${tables.get(name)!.createdIn}) is in ${count} groups`);
}
for (const name of grouped) if (!tables.has(name)) problems.push(`group lists ${name}, which no migration creates`);
for (const table of tables.values()) {
  for (const fk of table.foreignKeys) {
    const target = tables.get(fk.table);
    if (!target) problems.push(`${table.name}.${fk.name} → unknown table ${fk.table}`);
    else for (const col of fk.refColumns) if (!target.columns.some((c) => c.name === col)) problems.push(`${table.name}.${fk.name} → unknown column ${fk.table}.${col}`);
    for (const col of fk.columns) if (!table.columns.some((c) => c.name === col)) problems.push(`${table.name}.${fk.name}: unknown local column ${col}`);
  }
}

let html = '';
try {
  html = page(tables, migrations);
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
}
for (const name of created) if (!html.includes(`id="t-${name}"`)) problems.push(`table ${name} is missing from the output`);
if (problems.length > 0) {
  console.error(`schema check failed:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const htmlFile = path.join(outDir, 'schema.html');
writeFileSync(htmlFile, html);
console.log(`wrote ${path.relative(process.cwd(), htmlFile)}: ${tables.size} tables (${created.length} CREATE TABLE, all present), ${[...tables.values()].reduce((n, t) => n + t.foreignKeys.length, 0)} foreign keys`);

const playwright = (await import(pathToFileURL(path.resolve(here, '../next-frontend/node_modules/@playwright/test/index.mjs')).href)) as typeof import('@playwright/test');
const browser = await playwright.chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await tab.goto(pathToFileURL(htmlFile).href);
  const png = path.join(outDir, 'schema.png');
  await tab.screenshot({ path: png, fullPage: true });
  console.log(`wrote ${path.relative(process.cwd(), png)}`);
} finally {
  await browser.close();
}
