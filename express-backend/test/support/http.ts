// Test doubles for the HTTP layer. The fake AuthService stands in for the
// database-backed service at its interface; real behaviour is covered by
// test/db/auth-api.test.ts against MySQL.
import { AuthenticationError, InvalidCredentialsError } from '../../src/access/sessions.js';
import type { AuthService, Principal } from '../../src/access/sessions.js';
import { createAssistantService } from '../../src/assistant/assistant-service.js';
import type { CompensationInsights } from '../../src/assistant/compensation-insights.js';
import { createToolRegistry } from '../../src/assistant/tools.js';
import { SalaryAdjustmentError } from '../../src/compensation/salary-adjustment-service.js';
import type { SalaryAdjustmentService } from '../../src/compensation/salary-adjustment-service.js';
import { HrAccessError } from '../../src/access/hr-access-service.js';
import type { HrAccessService } from '../../src/access/hr-access-service.js';
import type { DashboardService } from '../../src/dashboard/dashboard-service.js';
import type { DirectoryService } from '../../src/directory/directory-repository.js';
import { createApp } from '../../src/http/app.js';
import type { AppDependencies } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';

// Synthetic test-only values.
export const FAKE_PASSWORD = 'synthetic-http-test-password';
export const FAKE_TOKEN = 'fake.jwt.token-for-meera';
export const EXPIRES_AT = new Date('2026-11-14T12:00:00.000Z');

export const MEERA: Principal = {
  hrUserId: 1,
  email: 'meera.iyer@acme.com',
  displayName: 'Meera Iyer',
  role: 'ADMIN',
  status: 'ACTIVE',
  countries: [],
  departments: [],
  sessionId: '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10',
  sessionExpiresAt: EXPIRES_AT,
};

/** Tokens that make the fake authenticate() fail with a given internal reason. */
export const FAILING_TOKENS = {
  'token.invalid.signature': 'INVALID_TOKEN',
  'token.missing.session': 'SESSION_NOT_FOUND',
  'token.revoked.session': 'SESSION_REVOKED',
  'token.expired.session': 'SESSION_EXPIRED',
  'token.inactive.user': 'USER_INACTIVE',
} as const;

export function fakeAuth(): AuthService {
  return {
    async signIn(email, password) {
      if (email === MEERA.email && password === FAKE_PASSWORD) return { token: FAKE_TOKEN, expiresAt: EXPIRES_AT };
      throw new InvalidCredentialsError();
    },
    async authenticate(token) {
      if (token === FAKE_TOKEN) return MEERA;
      const reason = typeof token === 'string' && token in FAILING_TOKENS
        ? FAILING_TOKENS[token as keyof typeof FAILING_TOKENS]
        : 'INVALID_TOKEN';
      throw new AuthenticationError(reason);
    },
    async signOut(token) {
      if (token === FAKE_TOKEN || token === 'token.revoked.session') return { revoked: token === FAKE_TOKEN };
      throw new AuthenticationError('INVALID_TOKEN');
    },
  };
}

/** A directory double: empty results. Real behaviour: test/db/employee-directory.test.ts. */
export function fakeDirectory(): DirectoryService {
  return {
    async list(_principal, query) {
      return {
        employees: [],
        page: { number: query.page, size: query.pageSize, totalRows: 0, totalPages: 0 },
        sort: { field: query.sort, direction: query.direction, comparison: null },
        exchangeRate: null,
      };
    },
    async detail() {
      return null;
    },
    async options() {
      return { departments: [], countries: [], currencies: [], levels: [], statuses: [], sortFields: [], comparisonCurrencies: [] };
    },
  };
}

/** Insights double: no rows. Real behaviour: test/db/assistant-tools.test.ts. */
export function fakeInsights(): CompensationInsights {
  return {
    async topCompensated() {
      return { status: 'ok', rows: [], comparedInUsd: false };
    },
    async recentChanges() {
      return { rows: [], totalMatching: 0 };
    },
    async summary() {
      return [];
    },
  };
}

/** Tools and an assistant with no model configured, for apps that do not test the assistant. */
export function noModelAssistant(directory: DirectoryService, insights: CompensationInsights = fakeInsights()) {
  const tools = createToolRegistry({ directory, insights, exchangeRate: null });
  return { tools, assistant: createAssistantService({ model: null, tools, logger: () => undefined }) };
}

/** A salary-adjustment double: every operation is forbidden. Real behaviour: test/db/salary-adjustments.test.ts. */
export function fakeSalaryAdjustments(): SalaryAdjustmentService {
  const forbidden = async (): Promise<never> => {
    throw new SalaryAdjustmentError('FORBIDDEN');
  };
  return {
    preview: forbidden,
    applyDirect: forbidden,
    submitRequest: forbidden,
    listRequests: forbidden,
    getRequest: forbidden,
    approve: forbidden,
    cancel: forbidden,
  };
}

/** A dashboard double: an empty-scope answer for everyone. Real behaviour: test/db/dashboard.test.ts. */
export function fakeDashboard(): DashboardService {
  const envelope = () => ({
    asOf: '2026-11-15',
    generatedAt: '2026-11-15T00:00:00.000Z',
    access: { hasEmployeeAccess: false, message: 'Your HR account has no employee access.', scope: { kind: 'SCOPED' as const, countries: [], departments: [] } },
    filters: { department: null, country: null, currency: null, level: null, employmentStatus: null },
  });
  const usd = { available: false, unavailableReason: 'fake', exchangeRate: null, quoteDescription: null, disclaimer: 'fake' };
  const page = { number: 1, size: 25, totalRows: 0, totalPages: 0 };
  return {
    async summary() { return { ...envelope(), figures: null }; },
    async breakdowns(_p, q) { return { ...envelope(), breakdown: q.breakdown, population: 'CURRENTLY_WORKING', groups: [], notApplied: [], usdComparison: usd }; },
    async recentChanges(_p, q) { return { ...envelope(), periodDays: q.periodDays, emptyMessage: 'No compensation changes were recorded in this period.', changes: [], page, notApplied: [] }; },
    async withoutRecentAdjustment(_p, q) { return { ...envelope(), months: q.noAdjustmentMonths, definition: 'No recorded salary adjustment since import or during the selected period.', employees: [], page, notApplied: [] }; },
  };
}

/** An HR access double: every HR user is unknown. Real behaviour: test/db/hr-access.test.ts. */
export function fakeHrAccess(): HrAccessService {
  const notFound = async (): Promise<never> => {
    throw new HrAccessError('NOT_FOUND', { message: 'HR user not found.' });
  };
  return { list: notFound, get: notFound, audit: notFound, preview: notFound, create: notFound, change: notFound, previewPasswordRegeneration: notFound, regeneratePassword: notFound };
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  logs: LogEntry[];
  /** Moves the rate-limit clock forward. It starts at real time because
   * express-rate-limit compares the store's reset time with Date.now(). */
  advance(ms: number): void;
}

/** An app with the fake auth service, a captured log, and an injected clock. */
export function buildTestApp(overrides: Partial<AppDependencies> = {}): TestApp {
  const logs: LogEntry[] = [];
  let offsetMs = 0;
  const directory = fakeDirectory();
  const tools = createToolRegistry({ directory, insights: fakeInsights(), exchangeRate: null });
  const app = createApp({
    auth: fakeAuth(),
    directory,
    tools,
    assistant: createAssistantService({ model: null, tools, logger: (entry) => logs.push(entry) }),
    salaryAdjustments: fakeSalaryAdjustments(),
    dashboard: fakeDashboard(),
    hrAccess: fakeHrAccess(),
    logger: (entry) => logs.push(entry),
    clock: () => new Date(Date.now() + offsetMs),
    clientIpSource: 'socket',
    ...overrides,
  });
  return { app, logs, advance: (ms) => { offsetMs += ms; } };
}
