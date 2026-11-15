// Locates non-TypeScript assets (SQL migrations, the generated workbook).
// Source runs from src/... (tsx) and compiled code from dist/src/..., so a fixed
// relative path like '../../db/migrations' would point to dist/db in the build.
// Instead, walk up from this module to the nearest directory with package.json:
// that is express-backend/ in both layouts. dist/ never contains a package.json.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findPackageRoot(startFile: string): string {
  let dir = path.dirname(startFile);
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no package.json above ${startFile}`);
    dir = parent;
  }
}

export const PACKAGE_ROOT = findPackageRoot(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, 'db', 'migrations');
export const DEFAULT_WORKBOOK_PATH = path.join(PACKAGE_ROOT, 'generated', 'acme-employees.xlsx');
export const OPENAPI_FILE = path.join(PACKAGE_ROOT, 'openapi', 'openapi.json');
export const EXCHANGE_RATE_FILE = path.join(PACKAGE_ROOT, 'data', 'exchange-rates', 'usd-inr.json');
