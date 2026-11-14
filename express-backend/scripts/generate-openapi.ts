#!/usr/bin/env node
// Writes openapi/openapi.json from the Zod contract. The frontend generates
// its API types from this file; test/http-openapi.test.ts fails if it drifts.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildOpenApiDocument } from '../src/http/openapi.js';
import { OPENAPI_FILE } from '../src/paths.js';

await mkdir(path.dirname(OPENAPI_FILE), { recursive: true });
await writeFile(OPENAPI_FILE, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`Wrote ${OPENAPI_FILE}`);
