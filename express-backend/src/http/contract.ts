// The HTTP contract: Zod schemas used for runtime validation and response
// construction, and the same schemas exported as OpenAPI components
// (see openapi.ts). One definition, so the published contract cannot drift
// from what the server accepts and returns.
import { z } from 'zod';

import { HR_STATUSES, ROLES } from '../access/access-policy.js';
import { MAX_PASSWORD_LENGTH } from '../access/passwords.js';

export const API_PREFIX = '/api/v1';

export const PATHS = Object.freeze({
  health: '/health',
  login: `${API_PREFIX}/auth/login`,
  me: `${API_PREFIX}/auth/me`,
  logout: `${API_PREFIX}/auth/logout`,
  openapi: `${API_PREFIX}/openapi.json`,
});

/** Registry of schemas published as #/components/schemas/<id>. */
export const contractRegistry = z.registry<{ id: string; description?: string }>();

export const PUBLIC_ERROR_CODES = Object.freeze([
  'VALIDATION_ERROR',
  'INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'NOT_FOUND',
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
  INTERNAL_ERROR: 'An unexpected error occurred.',
});
