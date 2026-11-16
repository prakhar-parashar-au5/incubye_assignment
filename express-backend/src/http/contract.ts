// The HTTP contract: Zod schemas used for runtime validation and response
// construction, and the same schemas exported as OpenAPI components
// (see openapi.ts). One definition, so the published contract cannot drift
// from what the server accepts and returns.
import { z } from 'zod';

import { HR_STATUSES, ROLES } from '../access/access-policy.js';
import { MAX_PASSWORD_LENGTH } from '../access/passwords.js';
import { ADJUSTMENT_METHODS } from '../compensation/adjustment.js';
import { ADJUSTMENT_TARGETS } from '../compensation/plan.js';
import { CONFIRMATION_MODES } from '../compensation/preview-token.js';
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
  salaryAdjustmentPreview: `${API_PREFIX}/employees/:employeeCode/salary-adjustments/preview`,
  salaryAdjustments: `${API_PREFIX}/employees/:employeeCode/salary-adjustments`,
  employeeSalaryAdjustmentRequests: `${API_PREFIX}/employees/:employeeCode/salary-adjustment-requests`,
  salaryAdjustmentRequests: `${API_PREFIX}/salary-adjustment-requests`,
  salaryAdjustmentRequest: `${API_PREFIX}/salary-adjustment-requests/:requestId`,
  salaryAdjustmentRequestApprove: `${API_PREFIX}/salary-adjustment-requests/:requestId/approve`,
  salaryAdjustmentRequestCancel: `${API_PREFIX}/salary-adjustment-requests/:requestId/cancel`,
  dashboardSummary: `${API_PREFIX}/dashboard/summary`,
  dashboardBreakdowns: `${API_PREFIX}/dashboard/breakdowns`,
  dashboardRecentChanges: `${API_PREFIX}/dashboard/recent-changes`,
  dashboardWithoutRecentAdjustment: `${API_PREFIX}/dashboard/without-recent-adjustment`,
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
  'FORBIDDEN',
  'STALE_VERSION',
  'DUPLICATE_OPERATION',
  'PENDING_REQUEST_EXISTS',
  'REQUEST_NOT_PENDING',
  'EMPLOYEE_INELIGIBLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const);
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

/** Optional machine-readable detail for VALIDATION_ERROR on salary-adjustment routes. */
export const ERROR_REASONS = Object.freeze([
  'PREVIEW_EXPIRED',
  'PREVIEW_INVALID',
  'PREVIEW_MISMATCH',
  'PERCENTAGE_RANGE',
  'INVALID_AMOUNT',
  'NEGATIVE_RESULT',
  'NO_CHANGE',
  'ZERO_BONUS_PERCENTAGE',
  'BASE_NOT_POSITIVE',
  'SALARY_BAND',
  'PAST_EFFECTIVE_DATE',
  'EFFECTIVE_BEFORE_CURRENT',
  'FUTURE_CHANGE_EXISTS',
  'NOTE_REQUIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
] as const);
export type ErrorReason = (typeof ERROR_REASONS)[number];

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.enum(PUBLIC_ERROR_CODES),
      message: z.string(),
      reason: z.enum(ERROR_REASONS).optional().describe('Present on some VALIDATION_ERROR responses so the client can show the right state.'),
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
  FORBIDDEN: 'You do not have permission to perform this action.',
  STALE_VERSION: 'Compensation changed after this preview or request was created. Review a fresh preview.',
  DUPLICATE_OPERATION: 'This idempotency key was already used for a different operation.',
  PENDING_REQUEST_EXISTS: 'This employee already has a pending salary change request.',
  REQUEST_NOT_PENDING: 'This salary change request is no longer pending.',
  EMPLOYEE_INELIGIBLE: 'This employee is not eligible for a compensation adjustment.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Try again.',
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

// ---------------------------------------------------------------------------
// Salary adjustments (Task 09). See docs_human/11-salary-adjustments.md.

export const ADJUSTMENT_REASONS = Object.freeze(['PERFORMANCE', 'MARKET_ADJUSTMENT', 'PROMOTION', 'ROLE_CHANGE', 'CORRECTION'] as const);
export const REQUEST_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'CANCELLED', 'STALE'] as const);
export const MAX_NOTE_LENGTH = 2000;
/** Idempotency-Key header: 16..128 URL-safe characters (a UUID fits). */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export const SalaryAdjustmentCommand = z
  .strictObject({
    target: z.enum(ADJUSTMENT_TARGETS),
    method: z.enum(ADJUSTMENT_METHODS),
    value: z.string().min(1).max(16)
      .describe('Percentages: whole number (increase 1..200, decrease 1..50). Amounts: at most two decimals.'),
    effectiveFrom: z.iso.date().describe('Today (UTC business date) or later.'),
    reason: z.enum(ADJUSTMENT_REASONS),
    note: z.string().max(MAX_NOTE_LENGTH).nullable().optional()
      .describe('Required for CORRECTION. Blank is treated as no note. Do not include sensitive personal data.'),
  })
  .register(contractRegistry, { id: 'SalaryAdjustmentCommand' });
export type SalaryAdjustmentCommand = z.infer<typeof SalaryAdjustmentCommand>;

export const SalaryAdjustmentConfirmation = z
  .strictObject({
    previewToken: z.string().min(1).max(4096),
    adjustment: SalaryAdjustmentCommand.describe('The exact command that was previewed.'),
  })
  .register(contractRegistry, { id: 'SalaryAdjustmentConfirmation', description: 'Send with an Idempotency-Key header.' });

export const SalaryRequestCancellation = z
  .strictObject({ note: z.string().min(1).max(MAX_NOTE_LENGTH).describe('Required cancellation reason.') })
  .register(contractRegistry, { id: 'SalaryRequestCancellation' });

const SignedAmount = z.string().regex(/^-?\d+\.\d{2}$/);

const SalaryBandView = z.object({
  currency: z.enum(CURRENCIES),
  minAnnualBaseSalary: Money,
  maxAnnualBaseSalary: Money,
  maxAnnualBonus: Money,
  minPercentageIncrease: z.number().int(),
  maxPercentageIncrease: z.number().int(),
  minPercentageDecrease: z.number().int(),
  maxPercentageDecrease: z.number().int(),
});

const AdjustmentEmployee = z.object({
  employeeCode: z.string(),
  name: z.string(),
  email: z.string(),
  department: z.enum(DEPARTMENTS),
  jobTitle: z.string(),
  level: z.enum(LEVELS),
  country: z.enum(COUNTRY_CODES),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
});

export const SalaryAdjustmentPreview = z
  .object({
    employee: AdjustmentEmployee,
    adjustment: z.object({
      target: z.enum(ADJUSTMENT_TARGETS),
      method: z.enum(ADJUSTMENT_METHODS),
      value: z.string().describe('Normalized: amounts with two decimals.'),
      effectiveFrom: IsoDate,
      reason: z.enum(ADJUSTMENT_REASONS),
      note: z.string().nullable(),
    }),
    currency: z.enum(CURRENCIES),
    current: z.object({
      compensationVersion: z.number().int().positive().describe('Version of the record the adjustment is calculated from.'),
      state: z.enum(COMPENSATION_STATES),
      effectiveFrom: IsoDate,
      annualBaseSalary: Money,
      annualBonus: Money,
      annualCashCompensation: Money,
    }),
    proposed: z.object({ annualBaseSalary: Money, annualBonus: Money, annualCashCompensation: Money }),
    change: z.object({
      amount: SignedAmount.describe('Signed change of the adjusted target.'),
      direction: z.enum(['INCREASE', 'DECREASE']),
      percentage: SignedAmount.nullable().describe('Signed, two decimals. Null when the current value is zero.'),
      annualCashImpact: SignedAmount.describe('Signed change in annual cash compensation: the annual budget impact.'),
    }),
    salaryBand: SalaryBandView,
    validation: z.object({ valid: z.literal(true) }).describe('Invalid adjustments are rejected with VALIDATION_ERROR and a reason.'),
    warnings: z.object({
      futureChange: z.object({
        effectiveFrom: IsoDate,
        annualBaseSalary: Money,
        annualBonus: Money,
        message: z.string(),
      }).nullable().describe('An approved future change keeps its scheduled absolute amounts.'),
      pendingRequestWillBecomeStale: z.boolean().describe('Admin preview only: applying makes the pending request STALE.'),
    }),
    expectedCompensationVersion: z.number().int().positive(),
    confirmationMode: z.enum(CONFIRMATION_MODES),
    previewToken: z.string(),
    previewExpiresAt: z.iso.datetime(),
  })
  .register(contractRegistry, { id: 'SalaryAdjustmentPreview', description: 'Writes nothing. Valid for five minutes.' });
export type SalaryAdjustmentPreview = z.infer<typeof SalaryAdjustmentPreview>;

const HrUserRef = z.object({ displayName: z.string(), email: z.string() });

export const CompensationRecordView = z
  .object({
    version: z.number().int().positive(),
    annualBaseSalary: Money,
    annualBonus: Money,
    annualCashCompensation: Money,
    currency: z.enum(CURRENCIES),
    payFrequency: z.enum(PAY_FREQUENCIES),
    effectiveFrom: IsoDate,
    changeReason: z.enum(CHANGE_REASONS),
    changeNote: z.string().nullable(),
    changedBy: HrUserRef.nullable(),
    sourceRequestId: z.uuid().nullable(),
    recordedAt: z.iso.datetime(),
  })
  .register(contractRegistry, { id: 'CompensationRecordView' });
export type CompensationRecordView = z.infer<typeof CompensationRecordView>;

export const SalaryAdjustmentResult = z
  .object({ employeeCode: z.string(), compensation: CompensationRecordView })
  .register(contractRegistry, { id: 'SalaryAdjustmentResult' });
export type SalaryAdjustmentResult = z.infer<typeof SalaryAdjustmentResult>;

export const SalaryRequestView = z
  .object({
    requestId: z.uuid(),
    status: z.enum(REQUEST_STATUSES),
    employee: AdjustmentEmployee,
    requestedBy: HrUserRef,
    adjustment: z.object({
      target: z.enum(ADJUSTMENT_TARGETS),
      method: z.enum(ADJUSTMENT_METHODS),
      value: z.string(),
      currency: z.enum(CURRENCIES),
      previousValue: Money,
      proposedValue: Money,
      effectiveFrom: IsoDate,
      reason: z.enum(ADJUSTMENT_REASONS),
      note: z.string().nullable(),
    }),
    requestedAgainstVersion: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    decidedBy: HrUserRef.nullable().describe('The Admin who approved or cancelled. Null while pending and for STALE.'),
    decidedAt: z.iso.datetime().nullable(),
    decisionNote: z.string().nullable().describe('Cancellation note or stale reason.'),
    resultingCompensationVersion: z.number().int().positive().nullable(),
  })
  .register(contractRegistry, { id: 'SalaryRequestView' });
export type SalaryRequestView = z.infer<typeof SalaryRequestView>;

export const SalaryRequestResponse = z
  .object({ request: SalaryRequestView })
  .register(contractRegistry, { id: 'SalaryRequestResponse' });

export const SalaryRequestApproval = z
  .object({ request: SalaryRequestView, compensation: CompensationRecordView })
  .register(contractRegistry, { id: 'SalaryRequestApproval' });
export type SalaryRequestApproval = z.infer<typeof SalaryRequestApproval>;

export const SalaryRequestListQuery = z
  .strictObject({
    q: z.string().max(MAX_SEARCH_LENGTH).transform((s) => s.trim() || undefined).optional(),
    department: z.enum(DEPARTMENTS).optional().describe('Admin HR only.'),
    status: z.enum(REQUEST_STATUSES).optional(),
    sort: z.enum(['createdAt']).default('createdAt'),
    direction: z.enum(SORT_DIRECTIONS).default('desc'),
    page: positiveInt(1_000_000).default(1),
    pageSize: positiveInt(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .transform((query) => Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as typeof query);
export type SalaryRequestListQuery = z.output<typeof SalaryRequestListQuery>;

export const SalaryRequestList = z
  .object({
    requests: z.array(SalaryRequestView),
    page: z.object({
      number: z.number().int().positive(),
      size: z.number().int().positive(),
      totalRows: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative(),
    }),
  })
  .register(contractRegistry, { id: 'SalaryRequestList' });
export type SalaryRequestList = z.infer<typeof SalaryRequestList>;

// ---------------------------------------------------------------------------
// Compensation dashboard (Task 10). See docs_human/10-compensation-dashboard.md.

export const DASHBOARD_PERIOD_DAYS = Object.freeze(['7', '30', '90'] as const);
export const DASHBOARD_NO_ADJUSTMENT_MONTHS = Object.freeze(['3', '6', '12', '24'] as const);
export const DASHBOARD_BREAKDOWNS = Object.freeze(['DEPARTMENT', 'COUNTRY', 'CURRENCY', 'LEVEL', 'EMPLOYMENT_STATUS'] as const);
export type DashboardBreakdown = (typeof DASHBOARD_BREAKDOWNS)[number];
export const DASHBOARD_FILTER_NAMES = Object.freeze(['department', 'country', 'currency', 'level', 'employmentStatus'] as const);
export const DASHBOARD_LIST_MAX_PAGE_SIZE = 100;
export const NO_ADJUSTMENT_DEFINITION = 'No recorded salary adjustment since import or during the selected period.' as const;
export const NO_RECENT_CHANGES_MESSAGE = 'No compensation changes were recorded in this period.' as const;
export const NO_ACCESS_MESSAGE = 'Your HR account has no employee access.' as const;

const dashboardFilterFields = {
  department: z.enum(DEPARTMENTS).optional(),
  country: z.enum(COUNTRY_CODES).optional(),
  currency: z.enum(CURRENCIES).optional().describe('Currency of the selected compensation record.'),
  level: z.enum(LEVELS).optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
};
const periodDays = z.enum(DASHBOARD_PERIOD_DAYS).default('30').transform(Number)
  .describe('Recent changes: records created in the last 7, 30, or 90 days, measured back from now.');
const noAdjustmentMonths = z.enum(DASHBOARD_NO_ADJUSTMENT_MONTHS).default('12').transform(Number);
const dashboardPage = { page: positiveInt(1_000_000).default(1), pageSize: positiveInt(DASHBOARD_LIST_MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE) };
/** Strict query: repeated values arrive as arrays and fail; unknown keys fail. Drops unset keys. */
const dashboardQuery = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape)
  .transform((query) => Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as z.infer<z.ZodObject<T>>);

export const DashboardSummaryQuery = dashboardQuery({ ...dashboardFilterFields, periodDays, noAdjustmentMonths });
export type DashboardSummaryQuery = z.output<typeof DashboardSummaryQuery>;
export const DashboardBreakdownQuery = dashboardQuery({ ...dashboardFilterFields, breakdown: z.enum(DASHBOARD_BREAKDOWNS).default('DEPARTMENT') });
export type DashboardBreakdownQuery = z.output<typeof DashboardBreakdownQuery>;
export const DashboardRecentChangesQuery = dashboardQuery({ ...dashboardFilterFields, periodDays, ...dashboardPage });
export type DashboardRecentChangesQuery = z.output<typeof DashboardRecentChangesQuery>;
export const DashboardWithoutAdjustmentQuery = dashboardQuery({ ...dashboardFilterFields, noAdjustmentMonths, ...dashboardPage });
export type DashboardWithoutAdjustmentQuery = z.output<typeof DashboardWithoutAdjustmentQuery>;
export type DashboardFilters = Pick<DashboardSummaryQuery, 'department' | 'country' | 'currency' | 'level' | 'employmentStatus'>;

const DashboardFiltersView = z.object({
  department: z.enum(DEPARTMENTS).nullable(),
  country: z.enum(COUNTRY_CODES).nullable(),
  currency: z.enum(CURRENCIES).nullable(),
  level: z.enum(LEVELS).nullable(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).nullable(),
});

export const DashboardFilterNote = z
  .object({ filter: z.enum(DASHBOARD_FILTER_NAMES), reason: z.string() })
  .register(contractRegistry, { id: 'DashboardFilterNote', description: 'A selected filter that this section does not apply, and why.' });

export const DashboardAccess = z
  .object({
    hasEmployeeAccess: z.boolean().describe('False for an empty scope: no figures are returned and the UI shows the no-access message.'),
    message: z.string().nullable(),
    scope: z.object({ kind: z.enum(['ALL', 'SCOPED']), countries: z.array(z.string()), departments: z.array(z.string()) }),
  })
  .register(contractRegistry, { id: 'DashboardAccess' });

export const DashboardUsdComparison = z
  .object({
    available: z.boolean(),
    unavailableReason: z.string().nullable().describe('Present when no saved exchange rate is loaded. Native figures are unaffected.'),
    exchangeRate: ExchangeRateContext.nullable(),
    quoteDescription: z.string().nullable().describe('For example "1 USD = 93.9100 INR" (INR per one US dollar).'),
    disclaimer: z.string().describe('USD equivalents are informational; native amounts are authoritative.'),
  })
  .register(contractRegistry, { id: 'DashboardUsdComparison' });

const dashboardEnvelope = {
  asOf: IsoDate.describe('UTC business date used for current and upcoming compensation.'),
  generatedAt: z.iso.datetime(),
  access: DashboardAccess,
  filters: DashboardFiltersView,
};

const CurrencyAmounts = z.object({
  currency: z.enum(CURRENCIES),
  employeeCount: z.number().int().nonnegative(),
  annualBaseSalary: Money,
  annualCashCompensation: Money,
  usdEquivalent: z.object({ annualBaseSalary: Money, annualCashCompensation: Money }).nullable().describe('Comparison only.'),
});

const CompensationSnapshot = z.object({ annualBaseSalary: Money, annualBonus: Money, annualCashCompensation: Money });

const DashboardEmployeeRef = z.object({
  employeeCode: z.string(),
  name: z.string(),
  department: z.enum(DEPARTMENTS),
  country: z.enum(COUNTRY_CODES),
});

export const DashboardUpcomingChange = z
  .object({
    employee: DashboardEmployeeRef.extend({ employmentStatus: z.enum(EMPLOYMENT_STATUSES) }),
    currency: z.enum(CURRENCIES),
    previous: CompensationSnapshot.nullable(),
    scheduled: CompensationSnapshot,
    effectiveFrom: IsoDate,
    changeReason: z.enum(CHANGE_REASONS),
    approvedBy: z.object({ displayName: z.string() }).nullable(),
    requestId: z.uuid().nullable(),
  })
  .register(contractRegistry, { id: 'DashboardUpcomingChange' });

export const DashboardSummaryResponse = z
  .object({
    ...dashboardEnvelope,
    figures: z.object({
      headcount: z.object({
        currentlyWorking: z.number().int().nonnegative(),
        soonToJoin: z.number().int().nonnegative(),
        left: z.number().int().nonnegative(),
        notApplied: z.array(DashboardFilterNote),
      }),
      currentSpending: z.object({
        population: z.literal('CURRENTLY_WORKING'),
        byCurrency: z.array(CurrencyAmounts).describe('One row per native currency present. Never summed across currencies.'),
        notApplied: z.array(DashboardFilterNote),
      }),
      upcomingCommitment: z.object({
        definition: z.string(),
        byCurrency: z.array(z.object({
          currency: z.enum(CURRENCIES),
          soonToJoinCount: z.number().int().nonnegative(),
          soonToJoinAnnualCashCompensation: Money,
          approvedFutureChangeCount: z.number().int().nonnegative(),
          approvedFutureChangeAnnualCashImpact: z.string().regex(/^-?\d+\.\d{2}$/).describe('Signed: scheduled minus current annual cash.'),
          totalAnnualCashCommitment: z.string().regex(/^-?\d+\.\d{2}$/),
        })),
        upcomingChanges: z.object({
          total: z.number().int().nonnegative(),
          items: z.array(DashboardUpcomingChange).describe('Soonest first, at most 10.'),
        }),
        notApplied: z.array(DashboardFilterNote),
      }),
      requests: z.object({
        pending: z.number().int().nonnegative(),
        stale: z.number().int().nonnegative(),
        notApplied: z.array(DashboardFilterNote),
      }),
      recentChanges: z.object({ periodDays: z.number().int(), count: z.number().int().nonnegative(), notApplied: z.array(DashboardFilterNote) }),
      withoutRecentAdjustment: z.object({
        months: z.number().int(),
        definition: z.literal(NO_ADJUSTMENT_DEFINITION),
        count: z.number().int().nonnegative(),
        notApplied: z.array(DashboardFilterNote),
      }),
      usdComparison: DashboardUsdComparison.extend({
        currentSpending: z.object({ annualBaseSalary: Money, annualCashCompensation: Money }).nullable()
          .describe('Sum of per-currency USD equivalents. Informational only.'),
      }),
    }).nullable().describe('Null when the HR user has no employee access.'),
  })
  .register(contractRegistry, { id: 'DashboardSummaryResponse' });
export type DashboardSummaryResponse = z.infer<typeof DashboardSummaryResponse>;

export const DashboardBreakdownGroup = z
  .object({
    group: z.string().describe('Department name, country code, currency, level, or employment status.'),
    label: z.string(),
    currency: z.enum(CURRENCIES),
    basis: z.enum(['CURRENT_SPENDING', 'FUTURE_COMMITMENT', 'COUNT_ONLY']),
    employeeCount: z.number().int().positive(),
    annualBaseSalary: Money.nullable(),
    annualCashCompensation: Money.nullable(),
    averageAnnualCashCompensation: Money.nullable(),
    medianAnnualCashCompensation: Money.nullable(),
    minimumAnnualCashCompensation: Money.nullable(),
    maximumAnnualCashCompensation: Money.nullable(),
    usdEquivalent: z.object({ annualBaseSalary: Money, annualCashCompensation: Money }).nullable(),
  })
  .register(contractRegistry, {
    id: 'DashboardBreakdownGroup',
    description: 'One group in one native currency. Money is null for COUNT_ONLY (LEFT). Average and median round half-up to cents.',
  });

export const DashboardBreakdownResponse = z
  .object({
    ...dashboardEnvelope,
    breakdown: z.enum(DASHBOARD_BREAKDOWNS),
    population: z.string().describe('Which employees the groups cover.'),
    groups: z.array(DashboardBreakdownGroup),
    notApplied: z.array(DashboardFilterNote),
    usdComparison: DashboardUsdComparison,
  })
  .register(contractRegistry, { id: 'DashboardBreakdownResponse' });
export type DashboardBreakdownResponse = z.infer<typeof DashboardBreakdownResponse>;

const DashboardPage = z.object({
  number: z.number().int().positive(),
  size: z.number().int().positive(),
  totalRows: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const DashboardRecentChange = z
  .object({
    employee: DashboardEmployeeRef,
    currency: z.enum(CURRENCIES),
    previous: CompensationSnapshot.nullable(),
    new: CompensationSnapshot,
    changeReason: z.enum(CHANGE_REASONS),
    recordedAt: z.iso.datetime(),
    effectiveFrom: IsoDate,
    effectiveInFuture: z.boolean(),
    changedBy: z.object({ displayName: z.string() }).nullable(),
    requestId: z.uuid().nullable(),
  })
  .register(contractRegistry, { id: 'DashboardRecentChange' });

export const DashboardRecentChangesResponse = z
  .object({
    ...dashboardEnvelope,
    periodDays: z.number().int(),
    emptyMessage: z.literal(NO_RECENT_CHANGES_MESSAGE),
    changes: z.array(DashboardRecentChange),
    page: DashboardPage,
    notApplied: z.array(DashboardFilterNote),
  })
  .register(contractRegistry, { id: 'DashboardRecentChangesResponse', description: 'Records created in the period, newest first. INITIAL_IMPORT is excluded.' });
export type DashboardRecentChangesResponse = z.infer<typeof DashboardRecentChangesResponse>;

export const DashboardWithoutAdjustmentResponse = z
  .object({
    ...dashboardEnvelope,
    months: z.number().int(),
    definition: z.literal(NO_ADJUSTMENT_DEFINITION),
    employees: z.array(z.object({
      employee: DashboardEmployeeRef.extend({ level: z.enum(LEVELS) }),
      currency: z.enum(CURRENCIES),
      annualBaseSalary: Money,
      annualCashCompensation: Money,
      lastRecordedAdjustmentAt: z.iso.datetime().nullable().describe('Latest non-import record before the period, or null (none since import).'),
    })),
    page: DashboardPage,
    notApplied: z.array(DashboardFilterNote),
  })
  .register(contractRegistry, { id: 'DashboardWithoutAdjustmentResponse', description: 'Currently working employees only.' });
export type DashboardWithoutAdjustmentResponse = z.infer<typeof DashboardWithoutAdjustmentResponse>;
