import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCliArgs } from '../src/source-workbook/cli-options.js';

const SCRIPT = fileURLToPath(new URL('../scripts/generate-workbook.js', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000 });
}

describe('parseCliArgs', () => {
  // Detects: defaults that drift from the approved seed and generation date.
  test('uses the approved defaults', () => {
    assert.deepEqual(parseCliArgs([], { defaultOutputPath: '/out/acme-employees.xlsx' }), {
      help: false,
      outputPath: '/out/acme-employees.xlsx',
      seed: 20261114,
      generationDate: '2026-11-14',
      overwrite: false,
    });
  });

  // Detects: options parsed but not applied.
  test('accepts explicit output, seed, generation date, and overwrite', () => {
    const options = parseCliArgs(
      ['--output', 'tmp/x.xlsx', '--seed', '7', '--generation-date', '2025-01-31', '--overwrite'],
      { defaultOutputPath: '/out/acme-employees.xlsx' },
    );
    assert.equal(options.outputPath, path.resolve('tmp/x.xlsx'));
    assert.equal(options.seed, 7);
    assert.equal(options.generationDate, '2025-01-31');
    assert.equal(options.overwrite, true);
  });

  // Detects: lenient parsing such as parseInt("12abc") === 12 or a non-.xlsx target.
  test('rejects invalid input', () => {
    const parse = (argv) => parseCliArgs(argv, { defaultOutputPath: '/out/a.xlsx' });
    assert.throws(() => parse(['--seed', '12abc']), /seed/);
    assert.throws(() => parse(['--seed', '-1']), /seed/);
    assert.throws(() => parse(['--seed', '4294967296']), /seed/);
    assert.throws(() => parse(['--generation-date', '2026-02-30']), /generation-date/);
    assert.throws(() => parse(['--output', 'employees.csv']), /\.xlsx/);
    assert.throws(() => parse(['--unknown']), /Unknown option/);
  });
});

describe('generate-workbook command', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'acme-cli-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  // Detects: invalid input that exits 0 (a script in CI would look successful).
  test('exits non-zero with a short message for invalid input', () => {
    const outputPath = path.join(dir, 'never.xlsx');
    const result = runCli(['--output', outputPath, '--seed', 'abc']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /seed/);
    assert.ok(result.stderr.length < 500, 'error output should be short');
    assert.equal(existsSync(outputPath), false);
  });

  // Detects: the command overwriting an existing file without --overwrite.
  test('exits non-zero and keeps an existing file without --overwrite', async () => {
    const outputPath = path.join(dir, 'existing.xlsx');
    await writeFile(outputPath, 'keep me');
    const result = runCli(['--output', outputPath]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/);
    assert.equal(await readFile(outputPath, 'utf8'), 'keep me');
  });

  // Detects: a command that fails to write, or that prints employee records.
  test('writes the workbook and prints only a short summary', () => {
    const outputPath = path.join(dir, 'acme-employees.xlsx');
    const result = runCli(['--output', outputPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(outputPath));
    assert.match(result.stdout, /10000 employee rows/);
    assert.doesNotMatch(result.stdout, /@acme\.com|ACME0/);
    assert.ok(result.stdout.split('\n').length <= 10);
  });
});
