// The HTTP contract: Zod schemas used for runtime validation and response
// construction, and the same schemas exported as OpenAPI components
// (see openapi.ts). One definition, so the published contract cannot drift
// from what the server accepts and returns.
import { z } from 'zod';

import { ACCESS_OPERATIONS } from '../access/access-command.js';
import type { AccessOperationKind } from '../access/access-command.js';
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
  assistantConversations: `${API_PREFIX}/assistant/conversations`,
  assistantConversation: `${API_PREFIX}/assistant/conversations/:conversationId`,
  assistantConversationMessages: `${API_PREFIX}/assistant/conversations/:conversationId/messages`,
  mcp: `${API_PREFIX}/mcp`,
  adminAiTraces: `${API_PREFIX}/admin/ai-traces`,
  adminAiTraceOptions: `${API_PREFIX}/admin/ai-traces/options`,
  adminAiTraceSummary: `${API_PREFIX}/admin/ai-traces/summary`,
  adminAiTrace: `${API_PREFIX}/admin/ai-traces/:traceId`,
  adminAiTraceReview: `${API_PREFIX}/admin/ai-traces/:traceId/review`,
  adminMcpCalls: `${API_PREFIX}/admin/mcp-tool-calls`,
  adminMcpCall: `${API_PREFIX}/admin/mcp-tool-calls/:mcpCallId`,
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
  hrUsers: `${API_PREFIX}/hr-users`,
  hrUsersPreview: `${API_PREFIX}/hr-users/preview`,
  hrUser: `${API_PREFIX}/hr-users/:hrUserId`,
  hrUserAccessAudit: `${API_PREFIX}/hr-users/:hrUserId/access-audit`,
  hrUserProfilePreview: `${API_PREFIX}/hr-users/:hrUserId/profile/preview`,
  hrUserProfile: `${API_PREFIX}/hr-users/:hrUserId/profile`,
  hrUserPromotePreview: `${API_PREFIX}/hr-users/:hrUserId/promote/preview`,
  hrUserPromote: `${API_PREFIX}/hr-users/:hrUserId/promote`,
  hrUserScopesPreview: `${API_PREFIX}/hr-users/:hrUserId/scopes/preview`,
  hrUserScopes: `${API_PREFIX}/hr-users/:hrUserId/scopes`,
  hrUserDeactivatePreview: `${API_PREFIX}/hr-users/:hrUserId/deactivate/preview`,
  hrUserDeactivate: `${API_PREFIX}/hr-users/:hrUserId/deactivate`,
  hrUserReactivatePreview: `${API_PREFIX}/hr-users/:hrUserId/reactivate/preview`,
  hrUserReactivate: `${API_PREFIX}/hr-users/:hrUserId/reactivate`,
  hrUserRegeneratePasswordPreview: `${API_PREFIX}/hr-users/:hrUserId/regenerate-temporary-password/preview`,
  hrUserRegeneratePassword: `${API_PREFIX}/hr-users/:hrUserId/regenerate-temporary-password`,
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
  'LAST_ACTIVE_ADMIN',
  'EMAIL_TAKEN',
  'INVALID_SCOPE',
  'SELF_PASSWORD_REGENERATION_FORBIDDEN',
  'MODEL_PROVIDER_FAILED',
  'ASSISTANT_TURN_IN_PROGRESS',
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
  'MODEL_TIMEOUT',
  'MODEL_RATE_LIMITED',
  'MODEL_ERROR',
  'MODEL_INVALID_RESPONSE',
  'MODEL_NOT_CONFIGURED',
  'TURN_TIMEOUT',
  'TRACE_UNAVAILABLE',
  'DELETE_CONFIRMATION_REQUIRED',
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
  LAST_ACTIVE_ADMIN: 'You cannot deactivate the last active Admin HR user. Activate or create another Admin first.',
  EMAIL_TAKEN: 'An HR user with this email already exists.',
  INVALID_SCOPE: 'The country or department scope is not valid for this HR user.',
  SELF_PASSWORD_REGENERATION_FORBIDDEN: 'Ask another active Admin HR user to regenerate your temporary password.',
  MODEL_PROVIDER_FAILED: 'The assistant model did not answer. Try again.',
  ASSISTANT_TURN_IN_PROGRESS: 'This message is still being answered. Try again shortly.',
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
// Server-owned assistant conversations (AI Task 03). docs_human/13-ai-observability.md.

/** Idempotency-Key for message submission: 16..100 URL-safe characters (the stored column is 100). */
export const ASSISTANT_IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;
const ConversationId = z.uuid();

export const AssistantConversationListQuery = z.strictObject({
  page: positiveInt(1_000_000).default(1),
  pageSize: positiveInt(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type AssistantConversationListQuery = z.output<typeof AssistantConversationListQuery>;

/** Creating a conversation takes no input: the owner is the authenticated HR user. */
export const AssistantConversationCreateRequest = z.strictObject({})
  .register(contractRegistry, { id: 'AssistantConversationCreateRequest' });

export const AssistantMessageRequest = z
  .strictObject({
    content: z.string().min(1).max(MAX_ASSISTANT_MESSAGE_LENGTH).refine((text) => text.trim() !== '', { message: 'content must not be blank' }),
    retryOfTraceId: ConversationId.optional().describe('Set for a user-selected Retry (with a new Idempotency-Key): links the new turn to that earlier turn of this conversation.'),
  })
  .register(contractRegistry, {
    id: 'AssistantMessageRequest',
    description: 'Exactly one user message. Earlier messages come from the server; identity and scope come from the Bearer token.',
  });
export type AssistantMessageRequest = z.infer<typeof AssistantMessageRequest>;

export const AssistantConversationSummary = z
  .object({
    conversationId: ConversationId,
    createdAt: z.iso.datetime(),
    lastMessageAt: z.iso.datetime().nullable(),
    messageCount: z.number().int().nonnegative(),
    title: z.string().nullable().describe('The first 80 characters of the first user message.'),
  })
  .register(contractRegistry, { id: 'AssistantConversationSummary' });

export const AssistantConversationResponse = z.object({ conversation: AssistantConversationSummary })
  .register(contractRegistry, { id: 'AssistantConversationResponse' });

export const AssistantConversationListResponse = z
  .object({
    conversations: z.array(AssistantConversationSummary).describe('Most recently active first.'),
    page: z.object({ number: z.number().int().positive(), size: z.number().int().positive(), totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
  })
  .register(contractRegistry, { id: 'AssistantConversationListResponse' });

const AssistantTurnDetails = AssistantMessagesResponse.omit({ answer: true });

export const AssistantConversationMessage = z
  .object({
    sequence: z.number().int().positive().describe('Authoritative order within the conversation.'),
    role: z.enum(['user', 'assistant']),
    traceId: ConversationId.nullable(),
    createdAt: z.iso.datetime(),
    text: z.string().describe('User text, or the assistant answer (plain text). For a withheld answer, a fixed notice.'),
    response: AssistantTurnDetails.nullable().describe('Assistant messages only: tool statuses, cards, limitations. Null when withheld.'),
    withheld: z.boolean().describe('True when the saved answer is hidden because the caller\'s current employee scope no longer covers the '
      + 'scope recorded with its turn. The user\'s own message is never withheld.'),
  })
  .register(contractRegistry, { id: 'AssistantConversationMessage' });

export const AssistantConversationTurn = z
  .object({
    traceId: ConversationId,
    sequence: z.number().int().positive(),
    previousTraceId: ConversationId.nullable(),
    retryOfTraceId: ConversationId.nullable(),
    status: z.enum(['STARTED', 'COMPLETED', 'FAILED']),
    userMessageSequence: z.number().int().positive().nullable(),
    assistantMessageSequence: z.number().int().positive().nullable().describe('Null unless COMPLETED. A failed turn has no assistant message.'),
    error: z.object({
      code: z.enum(PUBLIC_ERROR_CODES),
      message: z.string(),
      reason: z.enum(ERROR_REASONS).nullable().describe('The same safe reason the message endpoint returned for this failure, when it had one.'),
    }).nullable().describe('FAILED turns only: the same public error the message endpoint returned.'),
  })
  .register(contractRegistry, { id: 'AssistantConversationTurn' });

export const AssistantConversationDetailResponse = z
  .object({
    conversation: AssistantConversationSummary,
    messages: z.array(AssistantConversationMessage).describe('Every saved message, in sequence order (not paginated). Missing sequence numbers mean deleted or expired turns.'),
    turns: z.array(AssistantConversationTurn).describe('Every saved turn, in sequence order. STARTED means the turn has not finished.'),
  })
  .register(contractRegistry, {
    id: 'AssistantConversationDetailResponse',
    description: 'Each turn records the actor\'s role, countries, and departments when it ran. A saved answer is returned unchanged while the '
      + 'caller\'s current scope covers that record (Admin HR, or Scoped HR whose countries and departments are each a superset); otherwise '
      + 'the whole answer (text, cards, limitations) is withheld and the turn is left out of model history. Turns recorded without a '
      + 'scope record are withheld for Scoped HR.',
  });

export const AssistantTurnResponse = AssistantMessagesResponse.extend({
  conversationId: ConversationId,
  traceId: ConversationId,
  previousTraceId: ConversationId.nullable(),
  userMessageSequence: z.number().int().positive(),
  assistantMessageSequence: z.number().int().positive(),
  withheld: z.boolean().describe('Replays only can be true: the saved answer is withheld because the caller\'s current scope no longer '
    + 'covers the scope recorded with the turn; answer is a fixed notice and toolCalls, cards, and limitations are empty.'),
}).register(contractRegistry, {
  id: 'AssistantTurnResponse',
  description: 'Returned only after the assistant message and the completed trace are saved.',
});
export type AssistantTurnResponse = z.infer<typeof AssistantTurnResponse>;

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
          approvedFutureChangeAnnualCashImpact: z.string().regex(/^-?\d+\.\d{2}$/).describe('Signed: scheduled minus selected annual cash (current for working employees, initial for soon-to-join employees).'),
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

// ---------------------------------------------------------------------------
// HR access management (Task 11). See docs_human/12-hr-access-management.md.
// Admin HR only. Every write needs an Idempotency-Key, the expected HR user
// version (when the user exists), and the exact confirmed preview.

export const HR_ACCESS_OPERATIONS = ACCESS_OPERATIONS;
export type HrAccessOperation = AccessOperationKind;
export const HR_USER_SORT_FIELDS = Object.freeze(['updatedAt', 'name', 'email'] as const);
export const HR_USER_LIST_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE', 'ALL'] as const);
export const ACCESS_AUDIT_ACTIONS = Object.freeze([
  'HR_USER_CREATED', 'COUNTRY_SCOPES_CHANGED', 'DEPARTMENT_SCOPES_CHANGED', 'HR_USER_ACTIVATED', 'HR_USER_DEACTIVATED',
  'DISPLAY_NAME_CHANGED', 'SCOPES_REPLACED', 'HR_USER_PROMOTED', 'TEMPORARY_PASSWORD_REGENERATED',
] as const);
export const ACCESS_SUMMARY_KINDS = Object.freeze(['ALL_EMPLOYEES', 'SCOPED', 'NO_EMPLOYEES', 'INACTIVE'] as const);
export const CHANGEABLE_ACCESS_FIELDS = Object.freeze(['displayName', 'role', 'status', 'countries', 'departments'] as const);
export const MAX_SCOPE_COUNTRIES = 10;
export const MAX_SCOPE_DEPARTMENTS = 20;
export const MAX_DEACTIVATION_REASON_LENGTH = 2000;
export const MAX_REACTIVATION_REASON_LENGTH = 500;
export const MAX_DISPLAY_NAME_LENGTH = 100;

export const NO_SCOPE_ACCESS_MESSAGE = 'This scope grants access to no employees.' as const;
export const NO_EMPLOYEE_ACCESS_USER_MESSAGE = 'This HR user currently has access to no employees.' as const;
export const NO_HR_USERS_MESSAGE = 'No HR users match these filters.' as const;
export const HR_USER_NOT_FOUND = 'HR user not found.' as const;
export const HR_USER_STALE_MESSAGE = 'This HR user changed after your preview. Review the current state and preview again.' as const;
export const TEMPORARY_PASSWORD_NOTICE = 'Share this temporary password through an approved channel. It is shown only once and no email was sent.' as const;
export const TEMPORARY_PASSWORD_UNAVAILABLE = 'This HR user already exists. The temporary password was shown only in the original response and cannot be shown again. Regenerate a temporary password to get a new one.' as const;
export const REGENERATED_PASSWORD_UNAVAILABLE = 'This regeneration already completed. Its temporary password cannot be shown again. Preview and confirm a new regeneration to get a new one.' as const;
export const REGENERATION_WARNING = "Confirming replaces this HR user's password. Every previous password and every active session stops working." as const;
export const MAX_REGENERATION_REASON_LENGTH = 2000;

const ScopeCountries = z.array(z.string().regex(/^[A-Z]{2}$/)).max(MAX_SCOPE_COUNTRIES)
  .refine((list) => new Set(list).size === list.length, 'countries must not repeat')
  .describe('ISO country codes. Unknown codes return 422 INVALID_SCOPE.');
const ScopeDepartments = z.array(z.string().min(1).max(100)).max(MAX_SCOPE_DEPARTMENTS)
  .refine((list) => new Set(list).size === list.length, 'departments must not repeat')
  .describe('Exact department names. Unknown names return 422 INVALID_SCOPE.');
const ExpectedVersion = z.number().int().min(1).max(4_294_967_295).describe('hr_users.version the preview was made against.');
const PreviewToken = z.string().min(1).max(4096);
const DisplayName = z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH);
const DeactivationReason = z.string().trim().min(1).max(MAX_DEACTIVATION_REASON_LENGTH);
const ReactivationReason = z.string().trim().min(1).max(MAX_REACTIVATION_REASON_LENGTH);

/** GET /hr-users. Repeated and unknown parameters are rejected. */
export const HrUserListQuery = z
  .strictObject({
    q: z.string().max(MAX_SEARCH_LENGTH).transform((s) => s.trim() || undefined).optional()
      .describe('Display name (partial, case-insensitive) or exact email (case-insensitive). Wildcards are literal.'),
    role: z.enum(ROLES).optional(),
    status: z.enum(HR_USER_LIST_STATUSES).default('ACTIVE').describe('ALL includes inactive users.'),
    country: z.enum(COUNTRY_CODES).optional().describe('Users whose access includes this country. Admin HR matches every country.'),
    department: z.enum(DEPARTMENTS).optional().describe('Users whose access includes this department. Admin HR matches every department.'),
    sort: z.enum(HR_USER_SORT_FIELDS).default('updatedAt'),
    direction: z.enum(SORT_DIRECTIONS).optional().describe('Default: desc for updatedAt, asc for name and email.'),
    page: positiveInt(1_000_000).default(1),
    pageSize: positiveInt(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .transform((query) => Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as typeof query);
export type HrUserListQuery = z.output<typeof HrUserListQuery>;

export const AccessAuditQuery = z.strictObject({
  page: positiveInt(1_000_000).default(1),
  pageSize: positiveInt(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type AccessAuditQuery = z.output<typeof AccessAuditQuery>;

// Preview bodies. Each confirmation is the same body plus previewToken.
const createFields = {
  email: z.email().max(254).describe('Unique without case sensitivity. Cannot change later.'),
  displayName: DisplayName,
  role: z.enum(ROLES),
  countries: ScopeCountries.describe('Empty for ADMIN. At least one for SCOPED.'),
  departments: ScopeDepartments.describe('Empty for ADMIN. At least one for SCOPED.'),
};
export const HrUserCreatePreviewRequest = z.strictObject(createFields).register(contractRegistry, { id: 'HrUserCreatePreviewRequest' });
export const HrUserCreateRequest = z.strictObject({ ...createFields, previewToken: PreviewToken })
  .register(contractRegistry, { id: 'HrUserCreateRequest', description: 'The exact previewed fields plus previewToken. Send with an Idempotency-Key header.' });
export const HrUserProfilePreviewRequest = z.strictObject({ expectedVersion: ExpectedVersion, displayName: DisplayName })
  .register(contractRegistry, { id: 'HrUserProfilePreviewRequest', description: 'Email and role cannot change here.' });
export const HrUserProfileRequest = z.strictObject({ expectedVersion: ExpectedVersion, displayName: DisplayName, previewToken: PreviewToken })
  .register(contractRegistry, { id: 'HrUserProfileRequest' });
export const HrUserPromotePreviewRequest = z.strictObject({ expectedVersion: ExpectedVersion })
  .register(contractRegistry, { id: 'HrUserPromotePreviewRequest', description: 'Scoped HR to Admin HR only. Demotion is not supported.' });
export const HrUserPromoteRequest = z.strictObject({ expectedVersion: ExpectedVersion, previewToken: PreviewToken })
  .register(contractRegistry, { id: 'HrUserPromoteRequest' });
export const HrUserScopesPreviewRequest = z.strictObject({ expectedVersion: ExpectedVersion, countries: ScopeCountries, departments: ScopeDepartments })
  .register(contractRegistry, { id: 'HrUserScopesPreviewRequest', description: 'Countries and departments are replaced together.' });
export const HrUserScopesRequest = z.strictObject({ expectedVersion: ExpectedVersion, countries: ScopeCountries, departments: ScopeDepartments, previewToken: PreviewToken })
  .register(contractRegistry, { id: 'HrUserScopesRequest' });
export const HrUserDeactivatePreviewRequest = z.strictObject({ expectedVersion: ExpectedVersion, reason: DeactivationReason })
  .register(contractRegistry, { id: 'HrUserDeactivatePreviewRequest' });
export const HrUserDeactivateRequest = z.strictObject({ expectedVersion: ExpectedVersion, reason: DeactivationReason, previewToken: PreviewToken })
  .register(contractRegistry, { id: 'HrUserDeactivateRequest' });
export const HrUserReactivatePreviewRequest = z.strictObject({ expectedVersion: ExpectedVersion, reason: ReactivationReason })
  .register(contractRegistry, { id: 'HrUserReactivatePreviewRequest' });
export const HrUserReactivateRequest = z.strictObject({ expectedVersion: ExpectedVersion, reason: ReactivationReason, previewToken: PreviewToken })
  .register(contractRegistry, { id: 'HrUserReactivateRequest' });
const RegenerationReason = z.string().trim().min(1).max(MAX_REGENERATION_REASON_LENGTH);
export const HrUserPasswordRegenerationPreviewRequest = z.strictObject({ expectedVersion: ExpectedVersion, reason: RegenerationReason })
  .register(contractRegistry, { id: 'HrUserPasswordRegenerationPreviewRequest' });
export const HrUserPasswordRegenerationRequest = z.strictObject({ expectedVersion: ExpectedVersion, reason: RegenerationReason, previewToken: PreviewToken })
  .register(contractRegistry, { id: 'HrUserPasswordRegenerationRequest', description: 'The previewed body plus previewToken. Send with an Idempotency-Key header.' });

/** Every command field an operation can carry, normalized. */
export interface HrAccessCommand {
  email?: string;
  displayName?: string;
  role?: (typeof ROLES)[number];
  countries?: string[];
  departments?: string[];
  reason?: string;
}

export const AccessSummary = z
  .object({
    kind: z.enum(ACCESS_SUMMARY_KINDS),
    text: z.string(),
    combinations: z.array(z.object({ country: z.string(), countryName: z.string(), department: z.string() }))
      .describe('The exact country x department cross-product. Empty for ALL_EMPLOYEES, NO_EMPLOYEES, and INACTIVE.'),
  })
  .register(contractRegistry, { id: 'AccessSummary', description: 'Country IN countries AND department IN departments.' });

export const HrUserView = z
  .object({
    hrUserId: z.number().int().positive(),
    displayName: z.string(),
    email: z.string(),
    role: z.enum(ROLES),
    status: z.enum(HR_STATUSES),
    countries: z.array(z.string()).describe('Always empty for ADMIN.'),
    departments: z.array(z.string()).describe('Always empty for ADMIN.'),
    accessSummary: AccessSummary,
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .register(contractRegistry, { id: 'HrUserView', description: 'Never contains a password, hash, or session data.' });

export const HrUserDetail = HrUserView.extend({
  accessibleEmployeeCount: z.number().int().nonnegative().describe('Employees the user can access now, from current employee data.'),
  noAccessMessage: z.string().nullable().describe(`"${NO_EMPLOYEE_ACCESS_USER_MESSAGE}" when the count is zero.`),
}).register(contractRegistry, { id: 'HrUserDetail' });

export const HrUserListResponse = z
  .object({
    users: z.array(HrUserView),
    page: z.object({ number: z.number().int().positive(), size: z.number().int().positive(), totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
    emptyMessage: z.literal(NO_HR_USERS_MESSAGE),
  })
  .register(contractRegistry, { id: 'HrUserListResponse' });
export type HrUserListResponse = z.infer<typeof HrUserListResponse>;

export const HrUserDetailResponse = z.object({ hrUser: HrUserDetail }).register(contractRegistry, { id: 'HrUserDetailResponse' });
export type HrUserDetailResponse = z.infer<typeof HrUserDetailResponse>;
export type HrUserDetail = z.infer<typeof HrUserDetail>;

const AccessStateView = z.object({
  displayName: z.string(),
  role: z.enum(ROLES),
  status: z.enum(HR_STATUSES),
  countries: z.array(z.string()),
  departments: z.array(z.string()),
  accessSummary: AccessSummary,
  accessibleEmployeeCount: z.number().int().nonnegative().describe('Estimated with current employee data and the scope policy.'),
});

export const HrAccessPreview = z
  .object({
    operation: z.enum(HR_ACCESS_OPERATIONS),
    hrUserId: z.number().int().positive().nullable().describe('Null for CREATE.'),
    email: z.string(),
    expectedVersion: z.number().int().positive().nullable().describe('Null for CREATE.'),
    changed: z.boolean().describe('False when the confirmation would change nothing (no version or audit event).'),
    changedFields: z.array(z.enum(CHANGEABLE_ACCESS_FIELDS)),
    current: AccessStateView.nullable().describe('Null for CREATE.'),
    proposed: AccessStateView,
    sessionsToRevoke: z.number().int().nonnegative(),
    reason: z.string().nullable(),
    previewToken: z.string().describe('Five minutes. Bound to this actor, session, operation, target, version, and command.'),
    previewExpiresAt: z.iso.datetime(),
  })
  .register(contractRegistry, { id: 'HrAccessPreview', description: 'Writes nothing. Editing any input requires a new preview.' });
export type HrAccessPreview = z.infer<typeof HrAccessPreview>;

const AuditStateView = z.object({
  displayName: z.string().nullable().describe('Null for events written before display names were audited.'),
  role: z.enum(ROLES),
  status: z.enum(HR_STATUSES),
  countries: z.array(z.string()),
  departments: z.array(z.string()),
});

export const AccessAuditEvent = z
  .object({
    action: z.enum(ACCESS_AUDIT_ACTIONS),
    occurredAt: z.iso.datetime(),
    actor: z.object({ hrUserId: z.number().int().positive(), displayName: z.string() }).nullable().describe('Null for system setup.'),
    target: z.object({ hrUserId: z.number().int().positive(), displayName: z.string(), email: z.string() }),
    before: AuditStateView.nullable(),
    after: AuditStateView,
    reason: z.string().nullable(),
    resultingVersion: z.number().int().positive().nullable().describe('Null only for events written before migration 004.'),
    revokedSessionCount: z.number().int().nonnegative().nullable(),
  })
  .register(contractRegistry, { id: 'AccessAuditEvent', description: 'Immutable. Never contains passwords, hashes, tokens, session IDs, or cookies.' });
export type AccessAuditEvent = z.infer<typeof AccessAuditEvent>;

export const AccessAuditResponse = z
  .object({
    hrUserId: z.number().int().positive(),
    events: z.array(AccessAuditEvent).describe('Newest first.'),
    page: z.object({ number: z.number().int().positive(), size: z.number().int().positive(), totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
  })
  .register(contractRegistry, { id: 'AccessAuditResponse' });
export type AccessAuditResponse = z.infer<typeof AccessAuditResponse>;

export const HrUserChangeResult = z
  .object({
    hrUser: HrUserDetail.describe('Current state (for a replay: the state now).'),
    changed: z.boolean(),
    auditEvent: AccessAuditEvent.nullable().describe('The event this operation wrote; null when nothing changed.'),
    revokedSessionCount: z.number().int().nonnegative(),
  })
  .register(contractRegistry, { id: 'HrUserChangeResult' });
export type HrUserChangeResult = z.infer<typeof HrUserChangeResult>;

export const HrUserCreateResult = z
  .object({
    hrUser: HrUserDetail,
    auditEvent: AccessAuditEvent,
    temporaryPassword: z.string().nullable().describe('Returned once, in the original successful response only. Null for an idempotent replay.'),
    credentialRecoveryRequired: z.boolean()
      .describe('False when temporaryPassword is present. True for a replay: the account exists, and the Admin must regenerate a temporary password to get one.'),
    temporaryPasswordNotice: z.string(),
  })
  .register(contractRegistry, { id: 'HrUserCreateResult', description: 'No email is sent.' });
export type HrUserCreateResult = z.infer<typeof HrUserCreateResult>;

export const HrUserPasswordRegenerationPreview = z
  .object({
    operation: z.literal('REGENERATE_PASSWORD'),
    target: z.object({ hrUserId: z.number().int().positive(), displayName: z.string(), email: z.string(), role: z.enum(ROLES), status: z.enum(HR_STATUSES) }),
    expectedVersion: z.number().int().positive(),
    sessionsToRevoke: z.number().int().nonnegative(),
    warning: z.literal(REGENERATION_WARNING),
    reason: z.string(),
    previewToken: z.string().describe('Five minutes. Bound to this actor, session, target, version, and reason.'),
    previewExpiresAt: z.iso.datetime(),
  })
  .register(contractRegistry, { id: 'HrUserPasswordRegenerationPreview', description: 'Writes nothing. Contains no password.' });
export type HrUserPasswordRegenerationPreview = z.infer<typeof HrUserPasswordRegenerationPreview>;

export const HrUserPasswordRegenerationResult = z
  .object({
    hrUser: HrUserDetail,
    auditEvent: AccessAuditEvent,
    revokedSessionCount: z.number().int().nonnegative(),
    temporaryPassword: z.string().nullable().describe('The new temporary password, once. Null for an idempotent replay.'),
    credentialRecoveryRequired: z.boolean().describe('True for a replay: preview and confirm a new regeneration (new Idempotency-Key) to get a password.'),
    temporaryPasswordNotice: z.string(),
  })
  .register(contractRegistry, { id: 'HrUserPasswordRegenerationResult', description: 'No email is sent. The previous password and every active session stop working.' });
export type HrUserPasswordRegenerationResult = z.infer<typeof HrUserPasswordRegenerationResult>;

// ---------------------------------------------------------------------------
// Admin AI observability (AI Task 04). docs_human/13-ai-observability.md.
// Every operation requires an active Admin HR user (Scoped HR: 403 FORBIDDEN).

export const AI_TRACE_STATUSES = Object.freeze(['STARTED', 'COMPLETED', 'FAILED'] as const);
/** Where a failed turn stopped. Same list as FAILURE_STAGES in assistant-service.ts (tested). */
export const AI_FAILURE_STAGES = Object.freeze([
  'TRACE_CREATE', 'MODEL_CALL', 'MODEL_TRACE_WRITE', 'TOOL_VALIDATION', 'TOOL_EXECUTION', 'TOOL_TRACE_WRITE', 'FINAL_TRACE_WRITE',
] as const);
export const AI_MODEL_CALL_STATUSES = Object.freeze(['STARTED', 'SUCCEEDED', 'FAILED'] as const);
export const AI_TOOL_VALIDATION_STATUSES = Object.freeze(['PENDING', 'VALID', 'REJECTED'] as const);
export const AI_TOOL_CALL_STATUSES = Object.freeze(['STARTED', 'REJECTED', 'SUCCEEDED', 'FAILED'] as const);
export const AI_REVIEW_VERDICTS = Object.freeze(['CORRECT', 'PARTIAL', 'INCORRECT'] as const);
export const AI_REVIEW_NOTE_MAX = 2000;
export const AI_SUMMARY_WINDOWS = Object.freeze(['24h', '7d', '30d'] as const);
export type AiSummaryWindow = (typeof AI_SUMMARY_WINDOWS)[number];
export const RAW_TRACE_WARNING = 'Raw trace data contains complete synthetic employee identities and compensation values.' as const;
export const FORMATTED_REDACTION_NOTE = 'Employee names, codes, and emails are replaced with placeholders in this view. Salary values are shown.' as const;
/** Known category values, published for display. Stored values are returned verbatim, so an unlisted value is still possible. */
export const AI_KNOWN_CATEGORIES = Object.freeze({
  traceError: ['not_configured', 'timeout', 'rate_limited', 'provider_error', 'invalid_response', 'turn_timeout', 'persistence_unavailable', 'payload_rejected', 'internal_error'],
  modelCallFailure: ['not_configured', 'timeout', 'rate_limited', 'provider_error', 'invalid_response', 'OUTCOME_NOT_RECORDED'],
  toolError: ['TOOL_FAILED', 'OUTPUT_TOO_LARGE', 'turn_timeout', 'OUTCOME_NOT_RECORDED'],
  toolRejection: ['UNKNOWN_TOOL', 'INVALID_ARGUMENTS', 'TOO_MANY_CALLS', 'TOOL_ROUND_LIMIT'],
  mcpError: ['TOOL_FAILED', 'OUTCOME_NOT_RECORDED'],
} as const);

const Instant = z.iso.datetime().describe('UTC instant.');
const TraceId = z.uuid();
const AiHrUser = z.object({ id: z.number().int().positive(), displayName: z.string() })
  .register(contractRegistry, { id: 'AiHrUser', description: 'An HR user shown by display name. Admin-only routes.' });
const ShortText = (max: number) => z.string().trim().min(1).max(max);
const Json = z.unknown().describe('Stored JSON value.');
const PageInfo = z.object({ number: z.number().int().positive(), size: z.number().int().positive(), totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() });
const PAGE_QUERY = { page: positiveInt(1_000_000).default(1), pageSize: positiveInt(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE) };
const dateRangeOk = (q: { from?: string | undefined; to?: string | undefined }) => q.from === undefined || q.to === undefined || q.from <= q.to;

export const AdminTraceListQuery = z.strictObject({
  from: IsoDate.optional().describe('UTC calendar date; traces started on or after 00:00 of this day.'),
  to: IsoDate.optional().describe('UTC calendar date, inclusive; traces started before 00:00 of the next day.'),
  hrUserId: positiveInt(2_147_483_647).optional(),
  status: z.enum(AI_TRACE_STATUSES).optional().describe('STARTED means still in progress.'),
  model: ShortText(120).optional().describe('Exact model name (see options).'),
  tool: ShortText(120).optional().describe('Exact tool name: traces with at least one call to it.'),
  errorCategory: ShortText(80).optional().describe('Exact trace error category (see options).'),
  ...PAGE_QUERY,
}).refine(dateRangeOk, { message: 'from must not be after to' });
export type AdminTraceListQuery = z.output<typeof AdminTraceListQuery>;

export const AdminTraceListItem = z.object({
  traceId: TraceId,
  conversationId: TraceId,
  turnSequence: z.number().int().positive(),
  hrUser: AiHrUser,
  status: z.enum(AI_TRACE_STATUSES),
  model: z.string(),
  toolNames: z.array(z.string()).describe('Distinct tool names in first-use order.'),
  startedAt: Instant,
  completedAt: Instant.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().describe('Count only; reasoning content is never recorded.'),
  modelCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  failureStage: z.string().nullable(),
  errorCategory: z.string().nullable(),
}).register(contractRegistry, { id: 'AdminTraceListItem', description: 'Summary only: never prompts, responses, arguments, results, or safe-error JSON.' });

export const AdminTraceListResponse = z.object({ traces: z.array(AdminTraceListItem).describe('Newest first.'), page: PageInfo })
  .register(contractRegistry, { id: 'AdminTraceListResponse' });

export const AdminTraceOptionsResponse = z.object({
  hrUsers: z.array(AiHrUser).describe('HR users with at least one stored trace or MCP call.'),
  models: z.array(z.string()),
  toolNames: z.array(z.string()).describe('Tool names in stored assistant or MCP calls.'),
  errorCategories: z.array(z.string()),
  failureStages: z.array(z.string()),
  statuses: z.array(z.enum(AI_TRACE_STATUSES)),
  enums: z.object({
    failureStages: z.array(z.enum(AI_FAILURE_STAGES)),
    modelCallStatuses: z.array(z.enum(AI_MODEL_CALL_STATUSES)),
    toolValidationStatuses: z.array(z.enum(AI_TOOL_VALIDATION_STATUSES)),
    toolCallStatuses: z.array(z.enum(AI_TOOL_CALL_STATUSES)),
    knownCategories: z.object({
      traceError: z.array(z.string()), modelCallFailure: z.array(z.string()), toolError: z.array(z.string()), toolRejection: z.array(z.string()), mcpError: z.array(z.string()),
    }),
  }).describe('Closed status and stage lists, and the known category values.'),
}).register(contractRegistry, { id: 'AdminTraceOptionsResponse' });

export const AdminTraceView = z.enum(['formatted', 'raw']);
export const AdminTraceDetailQuery = z.strictObject({
  view: AdminTraceView.default('formatted').describe('formatted: employee identities replaced by placeholders. raw: exact stored JSON, after the synthetic-data warning.'),
});

const ViewMeta = {
  view: AdminTraceView,
  warning: z.literal(RAW_TRACE_WARNING).nullable().describe('Set on the raw view only.'),
  redaction: z.object({ identities: z.enum(['PLACEHOLDERS', 'NONE']), note: z.string().nullable() }),
};

export const AdminTraceReview = z.object({
  verdict: z.enum(AI_REVIEW_VERDICTS),
  note: z.string(),
  nominated: z.boolean(),
  version: z.number().int().positive().describe('Send as expectedVersion to replace this review.'),
  reviewer: AiHrUser,
  createdAt: Instant,
  updatedAt: Instant,
}).register(contractRegistry, { id: 'AdminTraceReview' });

export const AdminModelCall = z.object({
  sequence: z.number().int().positive().describe('Trace-wide order of model calls.'),
  status: z.enum(AI_MODEL_CALL_STATUSES),
  provider: z.string(),
  model: z.string(),
  providerRequestId: z.string().nullable(),
  promptVersion: z.string(),
  promptHash: z.string(),
  input: Json.describe('Exact provider-neutral input: instructions, bounded messages, and this turn\'s tool exchanges.'),
  tools: Json.describe('Tool names and JSON schemas offered.'),
  output: Json.nullable().describe('{ text } when the model answered.'),
  toolDecisions: Json.nullable().describe('Requested calls: callId, name, parsed arguments (or { invalidJson: true }).'),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable().describe('Count only.'),
  startedAt: Instant,
  completedAt: Instant.nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  failureCategory: z.string().nullable().describe('Model-call category, separate from the trace error category.'),
  safeError: Json.nullable(),
}).register(contractRegistry, { id: 'AdminModelCall' });

export const AdminToolCall = z.object({
  sequence: z.number().int().positive().describe('Trace-wide order of tool calls.'),
  modelCallSequence: z.number().int().positive().describe('The model call that requested it.'),
  providerToolCallId: z.string().nullable(),
  toolName: z.string(),
  requestedArguments: Json.describe('As requested (secret keys scrubbed; { invalidJson: true } for unparseable text). There is no separate validated value.'),
  validationStatus: z.enum(AI_TOOL_VALIDATION_STATUSES),
  validationErrors: Json.nullable(),
  status: z.enum(AI_TOOL_CALL_STATUSES).describe('STARTED inside a STARTED trace: still running.'),
  result: Json.nullable().describe('SUCCEEDED only: { data, cards, limitations }.'),
  errorCategory: z.string().nullable(),
  safeError: Json.nullable(),
  startedAt: Instant,
  completedAt: Instant.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).register(contractRegistry, { id: 'AdminToolCall' });

export const AdminTraceDetailResponse = z.object({
  ...ViewMeta,
  trace: z.object({
    traceId: TraceId,
    conversationId: TraceId,
    turnSequence: z.number().int().positive(),
    previousTraceId: TraceId.nullable(),
    nextTraceId: TraceId.nullable().describe('The earliest later trace that links to this one.'),
    requestId: z.string(),
    hrUser: AiHrUser,
    status: z.enum(AI_TRACE_STATUSES),
    failureStage: z.string().nullable(),
    errorCategory: z.string().nullable(),
    model: z.string(),
    promptVersion: z.string(),
    promptHash: z.string(),
    startedAt: Instant,
    completedAt: Instant.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    modelCallCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
  }),
  userContent: Json.describe('{ text, retryOfTraceId } as submitted.'),
  modelMessages: Json.describe('The bounded conversation messages sent to the model.'),
  modelCalls: z.array(AdminModelCall),
  toolCalls: z.array(AdminToolCall),
  finalResponse: Json.nullable().describe('COMPLETED only. A failed trace never has one.'),
  messages: z.array(z.object({ sequence: z.number().int().positive(), role: z.enum(['USER', 'ASSISTANT']), createdAt: Instant })),
  review: AdminTraceReview.nullable(),
}).register(contractRegistry, { id: 'AdminTraceDetailResponse', description: 'One complete trace in server sequence order.' });

export const AdminTraceReviewRequest = z.strictObject({
  verdict: z.enum(AI_REVIEW_VERDICTS),
  note: z.string().max(AI_REVIEW_NOTE_MAX).default(''),
  nominated: z.boolean().default(false).describe('Nominated as an evaluation-fixture candidate. Nothing is copied automatically.'),
  expectedVersion: z.number().int().min(0).describe('0 for the first review; otherwise the current review.version.'),
}).register(contractRegistry, { id: 'AdminTraceReviewRequest' });
export const AdminTraceReviewResponse = z.object({ review: AdminTraceReview }).register(contractRegistry, { id: 'AdminTraceReviewResponse' });

export const AdminTraceDeleteQuery = z.strictObject({
  confirm: z.uuid().describe('Must equal the trace ID in the path.'),
});
export const AdminTraceDeleteResponse = z.object({
  deleted: z.object({
    traceId: TraceId,
    modelCalls: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    review: z.boolean(),
  }),
}).register(contractRegistry, { id: 'AdminTraceDeleteResponse' });

export const AdminMcpListQuery = z.strictObject({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  hrUserId: positiveInt(2_147_483_647).optional(),
  tool: ShortText(120).optional(),
  status: z.enum(AI_TOOL_CALL_STATUSES).optional(),
  ...PAGE_QUERY,
}).refine(dateRangeOk, { message: 'from must not be after to' });
export type AdminMcpListQuery = z.output<typeof AdminMcpListQuery>;

export const AdminMcpListItem = z.object({
  mcpCallId: TraceId,
  requestId: z.string(),
  hrUser: AiHrUser.describe('The authenticated HR user of the MCP client.'),
  toolName: z.string(),
  validationStatus: z.enum(AI_TOOL_VALIDATION_STATUSES),
  status: z.enum(AI_TOOL_CALL_STATUSES),
  startedAt: Instant,
  completedAt: Instant.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  errorCategory: z.string().nullable(),
}).register(contractRegistry, { id: 'AdminMcpListItem', description: 'Summary only: no arguments or results.' });
export const AdminMcpListResponse = z.object({ calls: z.array(AdminMcpListItem).describe('Newest first.'), page: PageInfo })
  .register(contractRegistry, { id: 'AdminMcpListResponse' });
export const AdminMcpDetailResponse = z.object({
  ...ViewMeta,
  call: AdminMcpListItem.extend({ requestedArguments: Json, validationErrors: Json.nullable(), result: Json.nullable(), safeError: Json.nullable() }),
}).register(contractRegistry, { id: 'AdminMcpDetailResponse' });

export const AdminTraceSummaryQuery = z.strictObject({ window: z.enum(AI_SUMMARY_WINDOWS).default('24h') });
const Count = z.number().int().nonnegative();
export const AdminTraceSummaryResponse = z.object({
  window: z.enum(AI_SUMMARY_WINDOWS),
  from: Instant.describe('Inclusive.'),
  to: Instant.describe('Inclusive; equal to generatedAt.'),
  generatedAt: Instant,
  traces: z.object({ total: Count, completed: Count, failed: Count, started: Count.describe('Still open (STARTED).') }),
  failures: z.array(z.object({ failureStage: z.string().nullable(), errorCategory: z.string().nullable(), count: Count })),
  durationMs: z.object({
    completedCount: Count,
    p50: Count.nullable(), p95: Count.nullable(), max: Count.nullable(),
  }).describe('COMPLETED traces only. Exact nearest-rank percentiles; null when there are none.'),
  tokens: z.object({ input: Count, output: Count, reasoning: Count.describe('Part of output; count only.'), total: Count.describe('input + output.') }),
  modelCalls: z.object({ total: Count, byModel: z.array(z.object({ model: z.string(), count: Count })) }),
  toolCalls: z.array(z.object({ toolName: z.string(), status: z.enum(AI_TOOL_CALL_STATUSES), count: Count })),
  mcpCalls: z.array(z.object({ toolName: z.string(), status: z.enum(AI_TOOL_CALL_STATUSES), count: Count })),
  reviews: z.object({ byVerdict: z.array(z.object({ verdict: z.enum(AI_REVIEW_VERDICTS), count: Count })), unreviewed: Count.describe('Finished traces without a review.') }),
  series: z.object({
    bucket: z.enum(['HOUR', 'DAY']),
    points: z.array(z.object({ start: Instant, traces: Count, failures: Count }))
      .describe('UTC-aligned buckets from the one containing from to the one containing to, zero-filled. The first and last are partial.'),
  }),
}).register(contractRegistry, {
  id: 'AdminTraceSummaryResponse',
  description: 'Aggregates for traces (and MCP calls) started in the window. Counts and measurements only: no content or identities.',
});
