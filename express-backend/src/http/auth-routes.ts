import { Router } from 'express';
import type { Request, RequestHandler } from 'express';

import { InvalidCredentialsError } from '../access/sessions.js';
import type { AuthService, Principal } from '../access/sessions.js';
import { CurrentUserResponse, LoginRequest, LoginResponse, PATHS } from './contract.js';
import { ApiError } from './errors.js';

const BEARER = /^Bearer ([^\s]+)$/;

/** The single Bearer token, or an UNAUTHENTICATED error. */
function bearerToken(req: Request): string {
  const match = BEARER.exec(req.get('authorization') ?? '');
  if (!match?.[1]) throw new ApiError(401, 'UNAUTHENTICATED');
  return match[1];
}

/** Locals set by requireAuth. */
export interface AuthLocals {
  principal: Principal;
}

/**
 * Authentication middleware: one Bearer token, then the existing
 * authenticate() (session, HR status, and scopes loaded from the database).
 * Every failure becomes the same public UNAUTHENTICATED response; the
 * internal reason is never sent.
 */
export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req);
    try {
      res.locals.principal = await auth.authenticate(token);
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, 'code') === 'UNAUTHENTICATED') throw new ApiError(401, 'UNAUTHENTICATED');
      throw error;
    }
    next();
  };
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export function authRoutes({ auth, loginLimiter }: { auth: AuthService; loginLimiter: RequestHandler }): Router {
  const router = Router();

  router.post(PATHS.login, noStore, loginLimiter, async (req, res) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
    let session: { token: string; expiresAt: Date };
    try {
      session = await auth.signIn(parsed.data.email, parsed.data.password);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) throw new ApiError(401, 'INVALID_CREDENTIALS');
      throw error;
    }
    // The summary comes from the same per-request lookup /me uses.
    const principal = await auth.authenticate(session.token);
    res.json(LoginResponse.parse({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: { id: principal.hrUserId, displayName: principal.displayName, email: principal.email, role: principal.role },
    }));
  });

  router.get(PATHS.me, noStore, requireAuth(auth), (_req, res) => {
    const principal = (res.locals as AuthLocals).principal;
    res.json(CurrentUserResponse.parse({
      user: {
        id: principal.hrUserId,
        displayName: principal.displayName,
        email: principal.email,
        role: principal.role,
        status: principal.status,
      },
      scope: { countries: principal.countries, departments: principal.departments },
      session: { expiresAt: principal.sessionExpiresAt.toISOString() },
    }));
  });

  // Logout needs only a validly signed token: repeating it after the session
  // is revoked still succeeds, and it never revokes another user's session.
  router.post(PATHS.logout, noStore, async (req, res) => {
    const token = bearerToken(req);
    try {
      await auth.signOut(token);
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, 'code') === 'UNAUTHENTICATED') throw new ApiError(401, 'UNAUTHENTICATED');
      throw error;
    }
    res.status(204).end();
  });

  return router;
}
