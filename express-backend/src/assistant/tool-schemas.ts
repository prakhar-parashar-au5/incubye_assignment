// Input schemas for the five read-only assistant tools. One Zod schema per
// tool validates arguments from both the OpenAI adapter and the MCP adapter.
//
// Optional fields are `.nullish()`: MCP clients may omit them, and OpenAI
// strict function calling (which requires every key) sends null instead.
import { z } from 'zod';

import { CURRENCIES } from '../source-workbook/constants.js';

export const TOOL_NAMES = Object.freeze([
  'search_employees',
  'get_employee_compensation',
  'get_top_compensated_employees',
  'get_recent_compensation_changes',
  'get_compensation_summary',
] as const);
export type ToolName = (typeof TOOL_NAMES)[number];

export const COMPENSATION_METRICS = Object.freeze(['ANNUAL_BASE', 'ANNUAL_CASH'] as const);
export type CompensationMetric = (typeof COMPENSATION_METRICS)[number];
export const SUMMARY_GROUPS = Object.freeze(['DEPARTMENT', 'COUNTRY', 'CURRENCY'] as const);
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];

const limit = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).nullish().describe(`1 to ${max}. Null means ${fallback}.`);

export const DEFAULT_LIMITS = Object.freeze({ search: 5, top: 5, recent: 10 });

export const TOOL_INPUT_SCHEMAS = Object.freeze({
  search_employees: z.strictObject({
    query: z.string().trim().min(1).max(100)
      .describe('Employee ID (exact or prefix), first, last, or full name (partial), or exact email address.'),
    limit: limit(10, DEFAULT_LIMITS.search),
  }),
  get_employee_compensation: z.strictObject({
    employeeCode: z.string().trim().toUpperCase().regex(/^ACME[0-9]{5}$/).describe('Employee ID such as ACME00001.'),
  }),
  get_top_compensated_employees: z.strictObject({
    metric: z.enum(COMPENSATION_METRICS).describe('ANNUAL_BASE: base salary. ANNUAL_CASH: base salary plus bonus.'),
    currency: z.enum(CURRENCIES).nullish()
      .describe('Restrict to one native currency. Null compares INR and USD employees by USD equivalent.'),
    comparisonCurrency: z.enum(['USD']).nullish().describe('Only USD is supported. Null means USD.'),
    limit: limit(10, DEFAULT_LIMITS.top),
  }),
  get_recent_compensation_changes: z.strictObject({
    days: z.number().int().min(1).max(365).describe('Look back this many days from now, by when HR recorded the change.'),
    limit: limit(20, DEFAULT_LIMITS.recent),
    includeInitialImport: z.literal(false).nullish()
      .describe('Always false: the initial import is not a salary change.'),
  }),
  get_compensation_summary: z.strictObject({
    groupBy: z.enum(SUMMARY_GROUPS),
    metric: z.enum(COMPENSATION_METRICS),
  }),
});

export type ToolInput<N extends ToolName> = z.output<(typeof TOOL_INPUT_SCHEMAS)[N]>;

export interface JsonObjectSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * JSON Schema for OpenAI strict function calling: every property listed in
 * `required` (nullish fields already accept null), and no extra properties.
 */
export function strictFunctionParameters(schema: z.ZodObject): JsonObjectSchema {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' });
  const { $schema: _ignored, ...rest } = json;
  if (rest.type !== 'object') throw new Error('tool input schema must be an object');
  const properties = (rest.properties ?? {}) as Record<string, unknown>;
  return { ...rest, type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
