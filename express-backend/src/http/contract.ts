// The HTTP contract: Zod schemas used for runtime validation and response
// construction, and the same schemas exported as OpenAPI components
// (see openapi.ts). One definition, so the published contract cannot drift
// from what the server accepts and returns.
import { z } from 'zod';

import { HR_STATUSES, ROLES } from '../access/access-policy.js';
import { MAX_PASSWORD_LENGTH } from '../access/passwords.js';
import {
  CHANGE_REASONS,
  COUNTRY_CODES,
  CURRENCIES,
  DEPARTMENTS,
  EMPLOYMENT_STATUSES,
  LEVELS,
  PAY_FREQUENCIES,
} from '../source-workbook/constants.js';

export const API_PREFIX = '/api/v1';

export const PATHS = Object.freeze({
  health: '/health',
  login: `${API_PREFIX}/auth/login`,
  me: `${API_PREFIX}/auth/me`,
  logout: `${API_PREFIX}/auth/logout`,
  openapi: `${API_PREFIX}/openapi.json`,
  employees: `${API_PREFIX}/employees`,
  employee: `${API_PREFIX}/employees/:employeeCode`,
  directoryOptions: `${API_PREFIX}/employee-directory/options`,
  assistantMessages: `${API_PREFIX}/assistant/messages`,
  mcp: `${API_PREFIX}/mcp`,
});

/** Registry of schemas published as #/components/schemas/<id>. */
export const contractRegistry = z.registry<{ id: string; description?: string }>();

export const PUBLIC_ERROR_CODES = Object.freeze([
  'VALIDATION_ERROR',
  'INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'ASSISTANT_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const);
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.enum(PUBLIC_ERROR_CODES),
      message: z.string(),
    }),
  })
  .register(contractRegistry, { id: 'ErrorResponse', description: 'The only public error shape.' });

export const HealthResponse = z
  .object({ status: z.literal('ok') })
  .register(contractRegistry, { id: 'HealthResponse' });

// Strict: unknown fields are rejected, not ignored.
export const LoginRequest = z
  .strictObject({
    email: z.email().max(254),
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .register(contractRegistry, { id: 'LoginRequest' });
export type LoginRequest = z.infer<typeof LoginRequest>;

const UserSummary = z.object({
  id: z.number().int().positive(),
  displayName: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
});

export const LoginResponse = z
  .object({
    token: z.string().describe('Signed JWT. Send as "Authorization: Bearer <token>".'),
    expiresAt: z.iso.datetime(),
    user: UserSummary,
  })
  .register(contractRegistry, { id: 'LoginResponse' });

export const CurrentUserResponse = z
  .object({
    user: UserSummary.extend({ status: z.enum(HR_STATUSES) }),
    scope: z.object({
      countries: z.array(z.string()),
      departments: z.array(z.string()),
    }),
    session: z.object({ expiresAt: z.iso.datetime() }),
  })
  .register(contractRegistry, { id: 'CurrentUserResponse', description: 'Loaded from the database on every request.' });

/** Public messages, one per code. Internal reasons never reach the client. */
export const PUBLIC_MESSAGES: Readonly<Record<PublicErrorCode, string>> = Object.freeze({
  VALIDATION_ERROR: 'Request is invalid.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  UNAUTHENTICATED: 'Authentication is required.',
  RATE_LIMITED: 'Too many failed login attempts. Try again later.',
  NOT_FOUND: 'Route not found.',
  ASSISTANT_UNAVAILABLE: 'The assistant is unavailable. Other features are not affected.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
});

// ---------------------------------------------------------------------------
// Employee directory (Task 07)

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_SEARCH_LENGTH = 100;

export const SALARY_SORT_FIELDS = Object.freeze(['annualBaseSalary', 'annualCashCompensation'] as const);
export const SORT_FIELDS = Object.freeze([
  'name', 'employeeCode', 'department', 'country', 'level', 'hireDate', ...SALARY_SORT_FIELDS,
] as const);
export type SortField = (typeof SORT_FIELDS)[number];
export const SORT_DIRECTIONS = Object.freeze(['asc', 'desc'] as const);
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export const COMPARISON_CURRENCIES = Object.freeze(['USD'] as const);
export const COMPENSATION_STATES = Object.freeze(['CURRENT', 'UPCOMING', 'HISTORICAL'] as const);
export type CompensationState = (typeof COMPENSATION_STATES)[number];

const isSalarySort = (sort: SortField): boolean => (SALARY_SORT_FIELDS as readonly string[]).includes(sort);

/** A positive integer written without sign, leading zero, decimal point, or exponent. */
const positiveInt = (max: number) =>
  z.string().regex(/^[1-9][0-9]{0,6}$/).transform(Number).pipe(z.number().int().min(1).max(max));

/**
 * Query string for GET /employees. Each parameter is a single string: Express
 * gives an array for a repeated parameter, which fails z.string(). Unknown
 * parameters are rejected.
 */
export const DirectoryQueryParams = z
  .strictObject({
    q: z.string().max(MAX_SEARCH_LENGTH).transform((s) => s.trim() || undefined).optional()
      .describe('Employee ID (exact or prefix), first/last/full name (partial, case-insensitive), or exact email. Wildcards are literal.'),
    department: z.enum(DEPARTMENTS).optional(),
    country: z.enum(COUNTRY_CODES).optional(),
    currency: z.enum(CURRENCIES).optional().describe('Currency of the selected compensation record.'),
    level: z.enum(LEVELS).optional(),
    status: z.enum(EMPLOYMENT_STATUSES).optional(),
    sort: z.enum(SORT_FIELDS).default('name'),
    direction: z.enum(SORT_DIRECTIONS).default('asc'),
    page: positiveInt(1_000_000).default(1),
    pageSize: positiveInt(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    comparisonCurrency: z.enum(COMPARISON_CURRENCIES).optional().describe('Required for salary sorts.'),
  })
  .refine((query) => !isSalarySort(query.sort) || query.comparisonCurrency === 'USD', {
    message: 'salary sorting requires comparisonCurrency=USD',
    path: ['comparisonCurrency'],
  })
  // Drop keys whose value is undefined, so the parsed object only holds supplied fields.
  .transform((query) => Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as typeof query);
export type DirectoryQuery = z.output<typeof DirectoryQueryParams>;

const Money = z.string().regex(/^\d+\.\d{2}$/).describe('Exact decimal string with two decimal places.');
const IsoDate = z.iso.date();

export const ExchangeRateContext = z
  .object({
    baseCurrency: z.literal('USD'),
    quoteCurrency: z.literal('INR'),
    rate: z.string().describe('Quote units per one base unit: 1 USD = rate INR.'),
    sourceName: z.string(),
    sourceUrl: z.string(),
    effectiveDate: IsoDate,
    retrievedAt: z.iso.datetime(),
  })
  .register(contractRegistry, { id: 'ExchangeRateContext', description: 'Saved official snapshot used for USD equivalents and salary sorting.' });

export const SelectedCompensation = z
  .object({
    state: z.enum(COMPENSATION_STATES),
    version: z.number().int().positive(),
    annualBaseSalary: Money,
    annualBonus: Money,
    annualCashCompensation: Money.describe('annualBaseSalary + annualBonus, in the native currency.'),
    currency: z.enum(CURRENCIES),
    payFrequency: z.enum(PAY_FREQUENCIES),
    effectiveFrom: IsoDate,
    usdEquivalent: z
      .object({ annualBaseSalary: Money, annualCashCompensation: Money })
      .nullable()
      .describe('Display only: rounded half-up to cents. Null when an INR record has no saved rate.'),
  })
  .register(contractRegistry, {
    id: 'SelectedCompensation',
    description: 'CURRENT: latest record on or before the as-of date. UPCOMING: earliest future record. HISTORICAL: latest record on or before the end date.',
  });

const EmployeeSummaryFields = {
  employeeCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  department: z.enum(DEPARTMENTS),
  jobTitle: z.string(),
  level: z.enum(LEVELS),
  country: z.enum(COUNTRY_CODES),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
  hireDate: IsoDate,
};

export const DirectoryRow = z
  .object({ ...EmployeeSummaryFields, compensation: SelectedCompensation.nullable() })
  .register(contractRegistry, { id: 'DirectoryRow' });

export const DirectoryResponse = z
  .object({
    employees: z.array(DirectoryRow),
    page: z.object({
      number: z.number().int().positive(),
      size: z.number().int().positive(),
      totalRows: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative(),
    }),
    sort: z.object({
      field: z.enum(SORT_FIELDS),
      direction: z.enum(SORT_DIRECTIONS),
      comparison: z
        .object({ currency: z.enum(COMPARISON_CURRENCIES), exchangeRate: ExchangeRateContext.nullable() })
        .nullable()
        .describe('Present for salary sorts. exchangeRate is null only when every row is USD (currency=USD filter).'),
    }),
    exchangeRate: ExchangeRateContext.nullable().describe('Snapshot used for usdEquivalent values; null when no rate is loaded.'),
  })
  .register(contractRegistry, { id: 'DirectoryResponse' });

export const CompensationHistoryEntry = z
  .object({
    version: z.number().int().positive(),
    annualBaseSalary: Money,
    annualBonus: Money,
    annualCashCompensation: Money,
    currency: z.enum(CURRENCIES),
    payFrequency: z.enum(PAY_FREQUENCIES),
    effectiveFrom: IsoDate,
    changeReason: z.enum(CHANGE_REASONS),
  })
  .register(contractRegistry, { id: 'CompensationHistoryEntry' });

export const EmployeeDetailResponse = z
  .object({
    employee: z.object({
      ...EmployeeSummaryFields,
      employmentEndDate: IsoDate.nullable(),
      version: z.number().int().positive().describe('Employee record version, for later stale-edit checks.'),
    }),
    compensation: SelectedCompensation.nullable(),
    compensationHistory: z.array(CompensationHistoryEntry).describe('Every record, ordered by effectiveFrom then version.'),
    exchangeRate: ExchangeRateContext.nullable(),
  })
  .register(contractRegistry, { id: 'EmployeeDetailResponse' });

export const DirectoryOptionsResponse = z
  .object({
    departments: z.array(z.enum(DEPARTMENTS)),
    countries: z.array(z.object({ code: z.enum(COUNTRY_CODES), name: z.string() })),
    currencies: z.array(z.enum(CURRENCIES)),
    levels: z.array(z.enum(LEVELS)),
    statuses: z.array(z.enum(EMPLOYMENT_STATUSES)),
    sortFields: z.array(z.enum(SORT_FIELDS)),
    comparisonCurrencies: z.array(z.enum(COMPARISON_CURRENCIES)),
  })
  .register(contractRegistry, { id: 'DirectoryOptionsResponse', description: 'Only values that occur inside the caller\'s current scope.' });

export const EMPLOYEE_NOT_FOUND_MESSAGE = 'Employee not found.';

export type DirectoryResponse = z.infer<typeof DirectoryResponse>;
export type EmployeeDetailResponse = z.infer<typeof EmployeeDetailResponse>;
export type DirectoryOptionsResponse = z.infer<typeof DirectoryOptionsResponse>;

// ---------------------------------------------------------------------------
// Read-only assistant (Task 08). See builder_docs/shared/ai-assistant-contract.md.

export const MAX_ASSISTANT_MESSAGES = 10;
export const MAX_ASSISTANT_MESSAGE_LENGTH = 2000;

export const AssistantMessagesRequest = z
  .strictObject({
    messages: z
      .array(z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(MAX_ASSISTANT_MESSAGE_LENGTH),
      }))
      .min(1)
      .max(MAX_ASSISTANT_MESSAGES)
      .refine((messages) => messages.at(-1)?.role === 'user', { message: 'the final message must have role user' }),
  })
  .register(contractRegistry, {
    id: 'AssistantMessagesRequest',
    description: 'The conversation so far. The server derives identity and scope from the Bearer token only.',
  });
export type AssistantMessagesRequest = z.infer<typeof AssistantMessagesRequest>;

const SignedMoney = z.string().regex(/^-?\d+\.\d{2}$/);
export const AssistantMoney = z
  .object({ amount: SignedMoney.describe('Exact decimal string.'), currency: z.enum(CURRENCIES) })
  .register(contractRegistry, { id: 'AssistantMoney' });

const CardEmployee = z.object({
  employeeCode: z.string(),
  name: z.string(),
  department: z.enum(DEPARTMENTS),
  jobTitle: z.string(),
  level: z.enum(LEVELS),
  country: z.enum(COUNTRY_CODES),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
  compensation: z
    .object({
      state: z.enum(COMPENSATION_STATES),
      effectiveFrom: IsoDate,
      annualBaseSalary: AssistantMoney,
      annualBonus: AssistantMoney,
      annualCashCompensation: AssistantMoney,
      usdEquivalent: z.object({ annualBaseSalary: Money, annualCashCompensation: Money }).nullable()
        .describe('Display only, rounded half-up. Null when an INR record has no saved rate.'),
    })
    .nullable(),
});

export const EmployeeListCard = z
  .object({
    type: z.literal('employee_list'),
    title: z.string(),
    employees: z.array(CardEmployee),
    exchangeRate: ExchangeRateContext.nullable().describe('Present when the list was ranked or shown with USD equivalents.'),
  })
  .register(contractRegistry, { id: 'EmployeeListCard' });

export const CompensationSummaryCard = z
  .object({
    type: z.literal('compensation_summary'),
    title: z.string(),
    groupBy: z.enum(['DEPARTMENT', 'COUNTRY', 'CURRENCY']),
    metric: z.enum(['ANNUAL_BASE', 'ANNUAL_CASH']),
    population: z.literal('CURRENTLY_WORKING'),
    groups: z.array(z.object({
      group: z.string(),
      currency: z.enum(CURRENCIES),
      employeeCount: z.number().int().positive(),
      total: AssistantMoney,
      average: AssistantMoney,
      minimum: AssistantMoney,
      maximum: AssistantMoney,
      usdEquivalent: z.object({ total: Money, average: Money }).nullable()
        .describe('Context only, not an authoritative total.'),
    })).describe('One row per group and native currency. Currencies are never added together.'),
    exchangeRate: ExchangeRateContext.nullable(),
  })
  .register(contractRegistry, { id: 'CompensationSummaryCard' });

export const RecentChangesCard = z
  .object({
    type: z.literal('recent_changes'),
    title: z.string(),
    days: z.number().int().positive().describe('Window length, measured back from the current time by recordedAt.'),
    totalMatching: z.number().int().nonnegative(),
    changes: z.array(z.object({
      employeeCode: z.string(),
      name: z.string(),
      department: z.enum(DEPARTMENTS),
      country: z.enum(COUNTRY_CODES),
      version: z.number().int().positive(),
      recordedAt: z.iso.datetime().describe('When HR recorded the change (compensation_records.created_at, UTC). "Recent" is measured by this.'),
      effectiveFrom: IsoDate,
      changeReason: z.enum(CHANGE_REASONS),
      annualBaseSalary: AssistantMoney,
      annualBonus: AssistantMoney,
      previous: z.object({ annualBaseSalary: AssistantMoney, annualBonus: AssistantMoney, effectiveFrom: IsoDate }).nullable(),
      annualBaseSalaryChange: AssistantMoney.nullable().describe('Null when there is no previous record or the currency changed.'),
    })),
  })
  .register(contractRegistry, { id: 'RecentChangesCard' });

export const NoticeCard = z
  .object({
    type: z.literal('notice'),
    level: z.enum(['info', 'warning']),
    message: z.string(),
  })
  .register(contractRegistry, { id: 'NoticeCard' });

export const AssistantCard = z
  .discriminatedUnion('type', [EmployeeListCard, CompensationSummaryCard, RecentChangesCard, NoticeCard])
  .register(contractRegistry, { id: 'AssistantCard', description: 'Permission-filtered data returned by application tools, never by the model.' });
export type AssistantCard = z.infer<typeof AssistantCard>;

export const TOOL_CALL_STATUSES = Object.freeze(['completed', 'rejected', 'failed'] as const);
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const AssistantMessagesResponse = z
  .object({
    answer: z.string().describe('Model-written text. Treat figures in cards as authoritative.'),
    toolCalls: z.array(z.object({
      name: z.string(),
      status: z.enum(TOOL_CALL_STATUSES).describe('rejected: invalid tool name or arguments, not executed.'),
    })),
    cards: z.array(AssistantCard),
    limitations: z.array(z.string()),
    generatedAt: z.iso.datetime(),
  })
  .register(contractRegistry, { id: 'AssistantMessagesResponse' });
export type AssistantMessagesResponse = z.infer<typeof AssistantMessagesResponse>;
