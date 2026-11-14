// Test doubles for the HTTP layer. The fake AuthService stands in for the
// database-backed service at its interface; real behaviour is covered by
// test/db/auth-api.test.ts against MySQL.
import { AuthenticationError, InvalidCredentialsError } from '../../src/access/sessions.js';
import type { AuthService, Principal } from '../../src/access/sessions.js';
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
  const app = createApp({
    auth: fakeAuth(),
    logger: (entry) => logs.push(entry),
    clock: () => new Date(Date.now() + offsetMs),
    clientIpSource: 'socket',
    ...overrides,
  });
  return { app, logs, advance: (ms) => { offsetMs += ms; } };
}
