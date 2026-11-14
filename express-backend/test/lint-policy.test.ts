import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

// Runs the project's real ESLint configuration on small code samples.
// Detects: a lint config that silently stopped enforcing the migration policy
// (no explicit any, no @ts-ignore / @ts-nocheck, no unused values).
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: projectRoot });

async function ruleIds(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/lint-policy-sample.ts' });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('lint policy for TypeScript source', () => {
  test('rejects explicit any', async () => {
    assert.ok((await ruleIds('export const value: any = 1;\n')).includes('@typescript-eslint/no-explicit-any'));
  });

  test('rejects @ts-ignore', async () => {
    const code = '// @ts-ignore\nexport const value: number = 1;\n';
    assert.ok((await ruleIds(code)).includes('@typescript-eslint/ban-ts-comment'));
  });

  test('rejects @ts-nocheck', async () => {
    const code = '// @ts-nocheck\nexport const value = 1;\n';
    assert.ok((await ruleIds(code)).includes('@typescript-eslint/ban-ts-comment'));
  });

  test('rejects @ts-expect-error without a reason', async () => {
    const code = '// @ts-expect-error\nexport const value: number = "x";\n';
    assert.ok((await ruleIds(code)).includes('@typescript-eslint/ban-ts-comment'));
  });

  test('rejects unused values', async () => {
    assert.ok((await ruleIds('const unused = 1;\nexport const used = 2;\n')).includes('@typescript-eslint/no-unused-vars'));
  });

  // Control: clean code produces no findings, so the checks above are not vacuous.
  test('accepts clean code', async () => {
    assert.deepEqual(await ruleIds('export function add(a: number, b: number): number {\n  return a + b;\n}\n'), []);
  });
});
