import 'server-only';

import Ajv2020 from 'ajv/dist/2020';

import contract from '@/generated/api-openapi.json';
import { isSalarySort, type DirectoryQuery } from '@/lib/directory-url';

// Reads directory state from the page URL using the parameter schemas in the generated contract,
// so the accepted names, enums, and bounds are the backend's own.

type ParameterSpec = { name: string; in: string; schema: Record<string, unknown> };

const parameters = (contract.paths['/api/v1/employees'].get.parameters as ParameterSpec[]).filter((p) => p.in === 'query');
const ajv = new Ajv2020({ strict: false });
const validators = new Map(parameters.map((p) => [p.name, { schema: p.schema, validate: ajv.compile(p.schema) }]));

export const DIRECTORY_PARAMETER_NAMES: readonly string[] = parameters.map((p) => p.name);

export type ParsedDirectoryQuery = {
  query: DirectoryQuery;
  /** Names of known parameters whose values the backend would reject. */
  invalid: string[];
};

type SearchParams = Record<string, string | string[] | undefined>;

export function parseDirectoryQuery(searchParams: SearchParams): ParsedDirectoryQuery {
  const query: Record<string, string | number> = {};
  const invalid: string[] = [];

  for (const [name, { schema, validate }] of validators) {
    const raw = searchParams[name];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      invalid.push(name);
      continue;
    }
    const text = name === 'q' ? raw.trim() : raw;
    if (text === '') continue;
    let value: string | number = text;
    if (schema.type === 'integer') {
      if (!/^[1-9][0-9]{0,6}$/.test(text)) {
        invalid.push(name);
        continue;
      }
      value = Number(text);
    }
    if (!validate(value)) {
      invalid.push(name);
      continue;
    }
    query[name] = value;
  }

  const parsed = query as DirectoryQuery;
  if (isSalarySort(parsed.sort)) parsed.comparisonCurrency = 'USD';
  else delete parsed.comparisonCurrency;
  return { query: parsed, invalid };
}
