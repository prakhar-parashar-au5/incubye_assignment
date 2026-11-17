// Verifies the request-flow files against the real code.
//
//   node architecture-viz/flows/verify.ts          (Node 22.18+ strips the types; no dependencies)
//
// For every node: the file exists, and `symbol` occurs (as text) within ±3 lines of `line`.
// Also checks the flow structure (schema.ts): kinds, lanes, db-table fields, edge endpoints, edge
// order 1..n, node count 15–35, at most 3 alternatives. Exit code 0 only when everything passes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { structuralProblems, type Flow } from './schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const FLOW_FILES = readdirSync(here).filter((f) => /^F\d+-.*\.json$/.test(f)).sort();
if (FLOW_FILES.length === 0) throw new Error('no flow files found');
const TOLERANCE = 3;

const fileCache = new Map<string, string[]>();
function lines(file: string): string[] | null {
  const absolute = path.resolve(repoRoot, file);
  if (!absolute.startsWith(repoRoot + path.sep) || !existsSync(absolute)) return null;
  let cached = fileCache.get(absolute);
  if (!cached) {
    cached = readFileSync(absolute, 'utf8').split('\n');
    fileCache.set(absolute, cached);
  }
  return cached;
}

let failures = 0;
let checked = 0;
for (const name of FLOW_FILES) {
  const flow = JSON.parse(readFileSync(path.join(here, name), 'utf8')) as Flow;
  const problems = structuralProblems(flow);
  for (const node of flow.nodes) {
    checked += 1;
    const source = lines(node.file);
    if (!source) {
      problems.push(`${node.id}: file not found: ${node.file}`);
      continue;
    }
    const from = Math.max(0, node.line - 1 - TOLERANCE);
    const to = Math.min(source.length - 1, node.line - 1 + TOLERANCE);
    let found = -1;
    for (let i = from; i <= to; i += 1) {
      if (source[i].includes(node.symbol)) {
        found = i + 1;
        break;
      }
    }
    if (found === -1) {
      const elsewhere = source.findIndex((text) => text.includes(node.symbol));
      problems.push(
        `${node.id}: "${node.symbol}" not within ±${TOLERANCE} of ${node.file}:${node.line}` +
          (elsewhere === -1 ? ' (not in file)' : ` (first seen at line ${elsewhere + 1})`),
      );
    }
  }
  if (problems.length === 0) {
    console.log(`${flow.id} ${name}: ${flow.nodes.length} nodes, ${flow.edges.length} edges, ${flow.alternatives.length} alternatives — OK`);
  } else {
    failures += problems.length;
    console.error(`${flow.id} ${name}: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }
}

console.log(`${checked} nodes checked, ${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
