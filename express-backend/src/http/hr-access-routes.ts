// HR access-management routes (Admin HR only). Authentication first, then the
// role check (Scoped HR gets 403 whatever the body says), then strict
// validation, then the service, which rechecks the actor in MySQL under the
// row locks for every write. Never logs bodies, passwords, tokens, reasons, or
// idempotency keys: the request log records only the route pattern.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';

import { HrAccessError } from '../access/hr-access-service.js';
import type { ChangeOperation, HrAccessInput, HrAccessService } from '../access/hr-access-service.js';
import type { AuthService } from '../access/sessions.js';
import { errorCode } from '../errors.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import {
  AccessAuditQuery,
  AccessAuditResponse,
  HrAccessPreview,
  HrUserChangeResult,
  HrUserCreatePreviewRequest,
  HrUserCreateRequest,
  HrUserCreateResult,
  HrUserDeactivatePreviewRequest,
  HrUserDeactivateRequest,
  HrUserDetailResponse,
  HrUserListQuery,
  HrUserListResponse,
  HrUserPasswordRegenerationPreview,
  HrUserPasswordRegenerationPreviewRequest,
  HrUserPasswordRegenerationRequest,
  HrUserPasswordRegenerationResult,
  HrUserProfilePreviewRequest,
  HrUserProfileRequest,
  HrUserPromotePreviewRequest,
  HrUserPromoteRequest,
  HrUserReactivatePreviewRequest,
  HrUserReactivateRequest,
  HrUserScopesPreviewRequest,
  HrUserScopesRequest,
  IDEMPOTENCY_KEY,
  PATHS,
} from './contract.js';
import { ApiError } from './errors.js';

const STATUS: Readonly<Record<HrAccessError['code'], number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
  DUPLICATE_OPERATION: 409,
  LAST_ACTIVE_ADMIN: 409,
  EMAIL_TAKEN: 409,
  INVALID_SCOPE: 422,
  SELF_PASSWORD_REGENERATION_FORBIDDEN: 409,
});

/** Database availability and lock failures: retryable, so 503. */
const UNAVAILABLE_CODES = new Set([
  'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR',
]);

async function guarded(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HrAccessError) throw new ApiError(STATUS[error.code], error.code, error.publicMessage, error.reason);
    const code = errorCode(error);
    if (code !== undefined && UNAVAILABLE_CODES.has(code)) throw new ApiError(503, 'SERVICE_UNAVAILABLE');
    throw error;
  }
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

function idempotencyKey(req: Request): string {
  const key = req.get('idempotency-key');
  if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'An Idempotency-Key header of 16 to 128 letters, digits, "-" or "_" is required.', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return key;
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
  return parsed.data;
}

const param = (req: Request): string => {
  const value = req.params.hrUserId;
  return typeof value === 'string' ? value : '';
};

type Schema = { safeParse(value: unknown): { success: true; data: HrAccessInput } | { success: false } };

/** Per change operation: preview path and body, confirmation path, method, and body. */
const CHANGES: readonly { operation: ChangeOperation; previewPath: string; previewBody: Schema; path: string; method: 'post' | 'put'; body: Schema }[] = [
  { operation: 'PROFILE', previewPath: PATHS.hrUserProfilePreview, previewBody: HrUserProfilePreviewRequest, path: PATHS.hrUserProfile, method: 'post', body: HrUserProfileRequest },
  { operation: 'PROMOTE', previewPath: PATHS.hrUserPromotePreview, previewBody: HrUserPromotePreviewRequest, path: PATHS.hrUserPromote, method: 'post', body: HrUserPromoteRequest },
  { operation: 'SCOPES', previewPath: PATHS.hrUserScopesPreview, previewBody: HrUserScopesPreviewRequest, path: PATHS.hrUserScopes, method: 'put', body: HrUserScopesRequest },
  { operation: 'DEACTIVATE', previewPath: PATHS.hrUserDeactivatePreview, previewBody: HrUserDeactivatePreviewRequest, path: PATHS.hrUserDeactivate, method: 'post', body: HrUserDeactivateRequest },
  { operation: 'REACTIVATE', previewPath: PATHS.hrUserReactivatePreview, previewBody: HrUserReactivatePreviewRequest, path: PATHS.hrUserReactivate, method: 'post', body: HrUserReactivateRequest },
];

export function hrAccessRoutes({ auth, hrAccess: service }: { auth: AuthService; hrAccess: HrAccessService }): Router {
  const router = Router();
  const authenticated = requireAuth(auth);
  const principalOf = (res: Response) => (res.locals as AuthLocals).principal;
  // Frontend visibility is not authorization: every route checks the role here,
  // and every write rechecks the actor row in MySQL inside its transaction.
  const adminOnly: RequestHandler = (_req, res, next) => {
    if (principalOf(res).role !== 'ADMIN' || principalOf(res).status !== 'ACTIVE') throw new ApiError(403, 'FORBIDDEN');
    next();
  };
  const guard = [noStore, authenticated, adminOnly];
  const replayHeader = (res: Response, replayed: boolean) => {
    if (replayed) res.set('Idempotency-Replayed', 'true');
  };

  router.get(PATHS.hrUsers, ...guard, async (req, res) => {
    const query = parse(HrUserListQuery, req.query);
    await guarded(async () => {
      res.json(HrUserListResponse.parse(await service.list(principalOf(res), query)));
    });
  });

  router.post(PATHS.hrUsersPreview, ...guard, async (req, res) => {
    const input = parse(HrUserCreatePreviewRequest, req.body);
    await guarded(async () => {
      res.json(HrAccessPreview.parse(await service.preview(principalOf(res), 'CREATE', null, input)));
    });
  });

  router.post(PATHS.hrUsers, ...guard, async (req, res) => {
    const key = idempotencyKey(req);
    const input = parse(HrUserCreateRequest, req.body);
    await guarded(async () => {
      const { value, replayed } = await service.create(principalOf(res), input, key);
      replayHeader(res, replayed);
      res.status(201).json(HrUserCreateResult.parse(value));
    });
  });

  router.get(PATHS.hrUser, ...guard, async (req, res) => {
    await guarded(async () => {
      res.json(HrUserDetailResponse.parse(await service.get(principalOf(res), param(req))));
    });
  });

  router.get(PATHS.hrUserAccessAudit, ...guard, async (req, res) => {
    const query = parse(AccessAuditQuery, req.query);
    await guarded(async () => {
      res.json(AccessAuditResponse.parse(await service.audit(principalOf(res), param(req), query)));
    });
  });

  for (const change of CHANGES) {
    router.post(change.previewPath, ...guard, async (req, res) => {
      const input = parse(change.previewBody, req.body);
      await guarded(async () => {
        res.json(HrAccessPreview.parse(await service.preview(principalOf(res), change.operation, param(req), input)));
      });
    });
    router[change.method](change.path, ...guard, async (req, res) => {
      const key = idempotencyKey(req);
      const input = parse(change.body, req.body);
      await guarded(async () => {
        const { value, replayed } = await service.change(principalOf(res), change.operation, param(req), input, key);
        replayHeader(res, replayed);
        res.json(HrUserChangeResult.parse(value));
      });
    });
  }

  // Review fix 11a: Admin recovery of a lost or unknown temporary password.
  router.post(PATHS.hrUserRegeneratePasswordPreview, ...guard, async (req, res) => {
    const input = parse(HrUserPasswordRegenerationPreviewRequest, req.body);
    await guarded(async () => {
      res.json(HrUserPasswordRegenerationPreview.parse(await service.previewPasswordRegeneration(principalOf(res), param(req), input)));
    });
  });

  router.post(PATHS.hrUserRegeneratePassword, ...guard, async (req, res) => {
    const key = idempotencyKey(req);
    const input = parse(HrUserPasswordRegenerationRequest, req.body);
    await guarded(async () => {
      const { value, replayed } = await service.regeneratePassword(principalOf(res), param(req), input, key);
      replayHeader(res, replayed);
      res.json(HrUserPasswordRegenerationResult.parse(value));
    });
  });

  return router;
}
