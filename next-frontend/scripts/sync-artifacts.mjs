#!/usr/bin/env node
// Copies the generated architecture pages into the frontend, so the Artifacts section can serve
// them where architecture-viz/ is not present (Railway builds next-frontend on its own).
//
//   npm run artifacts:sync           copy ../architecture-viz/out/<allowlisted>.html into src/artifacts/generated/
//   npm run artifacts:check          exit 1 when the copy differs from the source; skips when the source is absent
//
// Options: --from <dir> (source directory), --to <dir> (destination directory).
// Only the names in src/artifacts/files.json are copied. A listed file that is missing from the
// source is removed from the copy, so the copy always mirrors the source exactly.
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
};
const check = args.includes('--check');
const source = option('--from', path.resolve(frontendRoot, '../architecture-viz/out'));
const target = option('--to', path.join(frontendRoot, 'src/artifacts/generated'));
const { files } = JSON.parse(await readFile(path.join(frontendRoot, 'src/artifacts/files.json'), 'utf8'));

async function exists(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}
async function isDirectory(dir) {
  try { return (await stat(dir)).isDirectory(); } catch { return false; }
}

if (!(await isDirectory(source))) {
  console.log(`Artifact source ${source} is not present; nothing to ${check ? 'check' : 'sync'}.`);
  process.exit(0);
}

const problems = [];
for (const name of files) {
  const from = path.join(source, name);
  const to = path.join(target, name);
  const [inSource, inCopy] = await Promise.all([exists(from), exists(to)]);
  if (check) {
    if (inSource !== inCopy) problems.push(`${name}: ${inSource ? 'missing from the copy' : 'not in the source but still copied'}`);
    else if (inSource && !(await readFile(from)).equals(await readFile(to))) problems.push(`${name}: copy differs from the source`);
    continue;
  }
  if (inSource) {
    await mkdir(target, { recursive: true });
    await copyFile(from, to);
    console.log(`Copied ${name}`);
  } else if (inCopy) {
    await rm(to);
    console.log(`Removed ${name} (no longer in the source)`);
  }
}

if (check) {
  if (problems.length) {
    console.error(`Artifact copy is stale. Run npm run artifacts:sync.\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Artifact copy is current.');
}
