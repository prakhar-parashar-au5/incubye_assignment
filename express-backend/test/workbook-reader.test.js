import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSourceWorkbook } from '../src/source-workbook/source-workbook.js';
import { readEmployeeWorkbook, toDecimalString } from '../src/seed/workbook-reader.js';
import { APPROVED_HEADERS, validRow, writeTestWorkbook } from './support/workbook-fixtures.js';

const GENERATION_DATE = '2026-11-14';
let dir;
let counter = 0;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'acme-reader-'));
});
after(() => rm(dir, { recursive: true, force: true }));

async function fixture(options) {
  counter += 1;
  const filePath = path.join(dir, `fixture-${counter}.xlsx`);
  await writeTestWorkbook(filePath, options);
  return filePath;
}

/** Asserts a WorkbookError whose details match the pattern. */
async function assertRejected(filePath, pattern) {
  await assert.rejects(readEmployeeWorkbook(filePath, { generationDate: GENERATION_DATE }), (error) => {
    assert.equal(error.code, 'INVALID_WORKBOOK', error.message);
    const text = [error.message, ...error.details].join('\n');
    assert.match(text, pattern, text);
    return true;
  });
}

describe('readEmployeeWorkbook: approved generated workbook', () => {
  let rows;
  before(async () => {
    const filePath = path.join(dir, 'approved.xlsx');
    await createSourceWorkbook({ outputPath: filePath, seed: 20261114, generationDate: GENERATION_DATE });
    rows = await readEmployeeWorkbook(filePath, { generationDate: GENERATION_DATE });
  });

  // Detects: rows dropped or duplicated while reading.
  test('reads all 10,000 employee rows', () => {
    assert.equal(rows.length, 10000);
  });

  // Detects: text, dates, enums, or money altered between the file and the
  // database row. Literal values from the approved generated workbook.
  test('maps selected rows exactly, with money as exact decimal strings', () => {
    const byCode = new Map(rows.map((r) => [r.employee_code, r]));
    assert.deepEqual(byCode.get('ACME00001'), {
      employee_code: 'ACME00001',
      first_name: 'Sneha',
      last_name: 'Singh',
      email: 'sneha.singh.acme00001@acme.com',
      department: 'HR',
      job_title: 'Compensation Analyst',
      level: 'SENIOR',
      country_code: 'IN',
      currency: 'INR',
      employment_status: 'CURRENTLY_WORKING',
      hire_date: '2023-01-27',
      employment_end_date: null,
      annual_base_salary: '3026700.00',
      pay_frequency: 'MONTHLY',
      annual_bonus: '531185.85',
      salary_effective_date: '2024-02-06',
    });
    assert.deepEqual(
      [byCode.get('ACME00027')].map((r) => [r.employment_status, r.employment_end_date, r.annual_base_salary, r.annual_bonus, r.currency]),
      [['LEFT', '2017-11-13', '82600.00', '0.00', 'USD']],
    );
    assert.deepEqual(
      [byCode.get('ACME00024')].map((r) => [r.employment_status, r.hire_date, r.salary_effective_date, r.annual_bonus]),
      [['SOON_TO_JOIN', '2027-01-30', '2027-01-30', '2000.00']],
    );
  });
});

describe('readEmployeeWorkbook: structure', () => {
  // Detects: a small valid file being rejected (makes every rejection test meaningless).
  test('accepts a small valid workbook', async () => {
    const rows = await readEmployeeWorkbook(await fixture(), { generationDate: GENERATION_DATE });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employee_code, 'ACME00001');
  });

  // Detects: reading whatever sheet happens to be first.
  test('rejects a workbook without an Employees worksheet', async () => {
    await assertRejected(await fixture({ sheetName: 'Sheet1' }), /Employees/);
  });

  // Detects: extra sheets whose data would be silently ignored.
  test('rejects a workbook with an extra worksheet', async () => {
    await assertRejected(await fixture({ extraSheet: 'Notes' }), /exactly one worksheet/);
  });

  test('rejects a missing header', async () => {
    const headers = APPROVED_HEADERS.filter((h) => h !== 'annual_bonus');
    await assertRejected(await fixture({ headers }), /missing header: annual_bonus/);
  });

  // Detects: an extra column (e.g. a stored monthly_salary) passing unnoticed.
  test('rejects an unexpected header', async () => {
    await assertRejected(await fixture({ headers: [...APPROVED_HEADERS, 'monthly_salary'] }), /unexpected header: monthly_salary/);
  });

  test('rejects a repeated header', async () => {
    await assertRejected(await fixture({ headers: [...APPROVED_HEADERS, 'email'] }), /repeated header: email/);
  });

  // Detects: name-based column lookup that hides a reordered template.
  test('rejects headers in the wrong order', async () => {
    const headers = [...APPROVED_HEADERS];
    [headers[1], headers[2]] = [headers[2], headers[1]];
    await assertRejected(await fixture({ headers }), /header order/);
  });

  test('rejects an empty workbook', async () => {
    await assertRejected(await fixture({ headers: [], rows: [] }), /empty/);
  });

  test('rejects a workbook with headers but no employee rows', async () => {
    await assertRejected(await fixture({ rows: [] }), /no employee rows/);
  });

  // Detects: formulas, whose cached result may differ from what Excel shows.
  test('rejects a formula cell', async () => {
    const filePath = await fixture({
      cell: (sheet) => {
        sheet.getCell('M2').value = { formula: '2400000+100000', result: 2500000 };
      },
    });
    await assertRejected(filePath, /row 2 annual_base_salary: formula/);
  });
});

describe('readEmployeeWorkbook: cell values', () => {
  // Detects: a row error not caught by the existing employee validator.
  test('rejects an invalid employee row by using the existing validator', async () => {
    const filePath = await fixture({ rows: [validRow({ currency: 'USD' })] });
    await assertRejected(filePath, /row 2 currency/);
  });

  // Detects: money typed as text in Excel being accepted as numbers.
  test('rejects salary stored as text', async () => {
    await assertRejected(await fixture({ rows: [validRow({ annual_base_salary: '2500000' })] }), /row 2 annual_base_salary: must be a numeric cell/);
  });

  // Detects: Excel date cells, which depend on the reader's locale and time zone.
  test('rejects a date stored as an Excel date cell', async () => {
    const filePath = await fixture({
      cell: (sheet) => {
        sheet.getCell('K2').value = new Date(Date.UTC(2022, 7, 14));
      },
    });
    await assertRejected(filePath, /row 2 hire_date: must be YYYY-MM-DD text/);
  });

  // Detects: error messages that leak salary values or full rows.
  test('does not include cell values in error messages', async () => {
    const filePath = await fixture({ rows: [validRow({ annual_base_salary: 123.45 })] });
    await assert.rejects(readEmployeeWorkbook(filePath, { generationDate: GENERATION_DATE }), (error) => {
      const text = [error.message, ...error.details].join('\n');
      assert.doesNotMatch(text, /123\.45|Aditi|Sharma/);
      return true;
    });
  });
});

describe('toDecimalString', () => {
  // Detects: float formatting such as "1000000.1" or "1e+21", or silent rounding.
  test('formats numbers as exact two-decimal strings', () => {
    assert.equal(toDecimalString(1000000.1), '1000000.10');
    assert.equal(toDecimalString(531185.85), '531185.85');
    assert.equal(toDecimalString(0), '0.00');
    assert.equal(toDecimalString(7000000), '7000000.00');
    assert.equal(toDecimalString(0.07), '0.07');
  });

  test('rejects more than two decimal places instead of rounding', () => {
    assert.throws(() => toDecimalString(1000000.105), /two decimal places/);
    assert.throws(() => toDecimalString(Number.NaN), /two decimal places/);
  });
});
