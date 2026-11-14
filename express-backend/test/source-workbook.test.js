import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import { generateEmployees } from '../src/source-workbook/employee-generator.js';
import { createSourceWorkbook, writeValidatedWorkbook } from '../src/source-workbook/source-workbook.js';

const SEED = 20261114;
const GENERATION_DATE = '2026-11-14';
const APPROVED_HEADERS = [
  'employee_id', 'first_name', 'last_name', 'email', 'department', 'job_title', 'level',
  'country_code', 'currency', 'employment_status', 'hire_date', 'employment_end_date',
  'annual_base_salary', 'pay_frequency', 'annual_bonus', 'salary_effective_date',
];
const column = (name) => APPROVED_HEADERS.indexOf(name) + 1;

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

describe('createSourceWorkbook: written workbook read back with ExcelJS', () => {
  let dir;
  let filePath;
  let workbook;
  let sheet;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'acme-workbook-'));
    filePath = path.join(dir, 'acme-employees.xlsx');
    const result = await createSourceWorkbook({ outputPath: filePath, seed: SEED, generationDate: GENERATION_DATE });
    assert.equal(result.rowCount, 10000);
    workbook = await readWorkbook(filePath);
    sheet = workbook.worksheets[0];
  });
  after(() => rm(dir, { recursive: true, force: true }));

  // Detects: a non-xlsx file (e.g. CSV with an .xlsx name). XLSX is a ZIP: "PK" header.
  test('is a valid .xlsx workbook', async () => {
    const bytes = await readFile(filePath);
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
  });

  // Detects: extra sheets or a renamed sheet that the importer would not find.
  test('contains one worksheet named Employees', () => {
    assert.deepEqual(workbook.worksheets.map((ws) => ws.name), ['Employees']);
  });

  // Detects: a missing header, missing rows, or trailing blank rows.
  test('contains one header row and 10,000 employee rows', () => {
    assert.equal(sheet.rowCount, 10001);
    assert.equal(sheet.actualRowCount, 10001);
  });

  // Detects: renamed, reordered, or missing columns.
  test('has the approved headers in the approved order', () => {
    assert.deepEqual(sheet.getRow(1).values.slice(1), APPROVED_HEADERS);
  });

  // Detects: a header that scrolls away in a 10,000-row sheet.
  test('freezes the first row', () => {
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
  });

  // Detects: a filter that covers only some columns or rows.
  test('enables filters over the complete data range', () => {
    assert.equal(sheet.autoFilter, 'A1:P10001');
  });

  // Detects: money written as text (breaks sums and sorting in Excel) or
  // without a two-decimal display format.
  test('writes salary and bonus as numeric cells with a two-decimal format', () => {
    for (let r = 2; r <= 10001; r += 1) {
      for (const name of ['annual_base_salary', 'annual_bonus']) {
        const cell = sheet.getRow(r).getCell(column(name));
        assert.equal(cell.type, ExcelJS.ValueType.Number, `${name} row ${r}`);
        assert.equal(cell.numFmt, '#,##0.00', `${name} row ${r}`);
      }
    }
  });

  // Detects: dates written as Excel date serials, which render by the reader's locale.
  test('writes dates as YYYY-MM-DD text', () => {
    for (let r = 2; r <= 10001; r += 1) {
      const row = sheet.getRow(r);
      for (const name of ['hire_date', 'salary_effective_date']) {
        const cell = row.getCell(column(name));
        assert.equal(cell.type, ExcelJS.ValueType.String, `${name} row ${r}`);
        assert.match(cell.value, /^\d{4}-\d{2}-\d{2}$/);
      }
      const end = row.getCell(column('employment_end_date'));
      if (row.getCell(column('employment_status')).value === 'LEFT') {
        assert.match(end.value, /^\d{4}-\d{2}-\d{2}$/);
      } else {
        assert.equal(end.type, ExcelJS.ValueType.Null, `employment_end_date row ${r}`);
      }
    }
  });

  // Detects: formulas, which a later import could evaluate or misread.
  test('contains no formula cells', () => {
    let formulaCells = 0;
    sheet.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (cell) => {
      if (cell.type === ExcelJS.ValueType.Formula || cell.formula !== undefined) formulaCells += 1;
    }));
    assert.equal(formulaCells, 0);
  });

  // Detects: missing drop-down lists, or lists that disagree with the approved values.
  test('adds Excel validation lists to controlled columns', () => {
    const expectedLists = {
      department: '"Tech,HR,Finance,Operations,Support"',
      level: '"JUNIOR,MID,SENIOR,LEAD,MANAGER"',
      country_code: '"IN,US"',
      currency: '"INR,USD"',
      employment_status: '"SOON_TO_JOIN,CURRENTLY_WORKING,LEFT"',
      pay_frequency: '"MONTHLY,ANNUAL"',
    };
    for (const [name, formula] of Object.entries(expectedLists)) {
      for (const r of [2, 5000, 10001]) {
        const validation = sheet.getRow(r).getCell(column(name)).dataValidation;
        assert.equal(validation?.type, 'list', `${name} row ${r}`);
        assert.deepEqual(validation.formulae, [formula], `${name} row ${r}`);
      }
    }
  });

  // Detects: overlapping validation ranges (observed: ExcelJS's per-cell merge
  // emitted both E2:E10001 and E10:E10001), which can make Excel offer to
  // "repair" the file. ExcelJS read-back hides overlaps, so inspect the XML.
  test('stores each validation list as one non-overlapping column range', async () => {
    const zip = await JSZip.loadAsync(await readFile(filePath));
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const ranges = [...xml.matchAll(/<dataValidation [^>]*sqref="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(ranges, ['E2:E10001', 'G2:G10001', 'H2:H10001', 'I2:I10001', 'J2:J10001', 'N2:N10001']);
  });

  // Detects: any value lost or altered between generation and the file
  // (rounding, type coercion, empty end dates, column shifts).
  test('round-trips the same logical data that the generator produced', () => {
    const fromFile = [];
    for (let r = 2; r <= 10001; r += 1) {
      const row = sheet.getRow(r);
      const employee = {};
      APPROVED_HEADERS.forEach((name, i) => {
        employee[name] = row.getCell(i + 1).value ?? null;
      });
      fromFile.push(employee);
    }
    assert.deepEqual(fromFile, generateEmployees({ seed: SEED, generationDate: GENERATION_DATE }));
  });
});

describe('writeValidatedWorkbook: safe output behaviour', () => {
  let dir;
  let valid;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'acme-workbook-safety-'));
    valid = generateEmployees({ seed: SEED, generationDate: GENERATION_DATE });
  });
  after(() => rm(dir, { recursive: true, force: true }));

  // Detects: a workbook written before (or despite) validation.
  test('does not create the workbook when data validation fails', async () => {
    const outputPath = path.join(dir, 'invalid.xlsx');
    const invalid = structuredClone(valid);
    invalid[42].currency = 'USD';
    await assert.rejects(
      writeValidatedWorkbook(invalid, { outputPath, generationDate: GENERATION_DATE }),
      (error) => error.code === 'INVALID_DATA' && error.details.some((d) => d.startsWith('ACME00043 currency')),
    );
    assert.equal(existsSync(outputPath), false);
    assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith('invalid')), []);
  });

  // Detects: silent overwrite of an existing (possibly hand-edited) workbook.
  test('does not overwrite an existing file without the overwrite option', async () => {
    const outputPath = path.join(dir, 'existing.xlsx');
    await writeFile(outputPath, 'keep me');
    await assert.rejects(
      createSourceWorkbook({ outputPath, seed: SEED, generationDate: GENERATION_DATE }),
      (error) => error.code === 'OUTPUT_EXISTS',
    );
    assert.equal(await readFile(outputPath, 'utf8'), 'keep me');
  });

  // Detects: an overwrite option that is accepted but ignored.
  test('replaces an existing file when overwrite is true', async () => {
    const outputPath = path.join(dir, 'replace.xlsx');
    await writeFile(outputPath, 'old');
    await createSourceWorkbook({ outputPath, seed: SEED, generationDate: GENERATION_DATE, overwrite: true });
    const workbook = await readWorkbook(outputPath);
    assert.equal(workbook.getWorksheet('Employees').actualRowCount, 10001);
    assert.deepEqual((await readdir(dir)).filter((f) => f.includes('.tmp')), []);
  });
});
