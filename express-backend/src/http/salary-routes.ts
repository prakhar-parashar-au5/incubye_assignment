// Salary-adjustment routes. Authentication first; then validation; then the
// service, which enforces role, scope, versions, locks, and idempotency.
// Never logs bodies, notes, salary values, preview tokens, or idempotency keys:
// the request log records only the route pattern, and unexpected errors log
// only their class name and code.
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';

import type { AuthService } from '../access/sessions.js';
import { SalaryAdjustmentError } from '../compensation/salary-adjustment-service.js';
import type { SalaryAdjustmentService } from '../compensation/salary-adjustment-service.js';
import { errorCode } from '../errors.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import {
  IDEMPOTENCY_KEY,
  PATHS,
  SalaryAdjustmentCommand,
  SalaryAdjustmentConfirmation,
  SalaryAdjustmentPreview,
  SalaryAdjustmentResult,
  SalaryRequestApproval,
  SalaryRequestCancellation,
  SalaryRequestList,
  SalaryRequestListQuery,
  SalaryRequestResponse,
} from './contract.js';
import type { PublicErrorCode } from './contract.js';
import { ApiError } from './errors.js';

const STATUS: Readonly<Record<SalaryAdjustmentError['code'], number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
  DUPLICATE_OPERATION: 409,
  PENDING_REQUEST_EXISTS: 409,
  REQUEST_NOT_PENDING: 409,
  EMPLOYEE_INELIGIBLE: 422,
});

/** Database availability and lock failures: retryable, so 503. */
const UNAVAILABLE_CODES = new Set([
  'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR',
]);

/** Maps service failures to the public error shape. */
async function guarded(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SalaryAdjustmentError) {
      throw new ApiError(STATUS[error.code], error.code as PublicErrorCode, error.publicMessage, error.reason);
    }
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

function body<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
  return parsed.data;
}

const param = (req: Request, name: string): string => {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
};

export function salaryRoutes({ auth, salaryAdjustments: service }: { auth: AuthService; salaryAdjustments: SalaryAdjustmentService }): Router {
  const router = Router();
  const authenticated = requireAuth(auth);
  const principalOf = (res: { locals: unknown }) => (res.locals as AuthLocals).principal;

  router.post(PATHS.salaryAdjustmentPreview, noStore, authenticated, async (req, res) => {
    const command = body(SalaryAdjustmentCommand, req.body);
    await guarded(async () => {
      res.json(SalaryAdjustmentPreview.parse(await service.preview(principalOf(res), param(req, 'employeeCode'), command)));
    });
  });

  router.post(PATHS.salaryAdjustments, noStore, authenticated, async (req, res) => {
    // Role first: Scoped HR gets FORBIDDEN whatever the body says.
    if (principalOf(res).role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN');
    const key = idempotencyKey(req);
    const confirmation = body(SalaryAdjustmentConfirmation, req.body);
    await guarded(async () => {
      const { value, replayed } = await service.applyDirect(principalOf(res), param(req, 'employeeCode'), confirmation, key);
      if (replayed) res.set('Idempotency-Replayed', 'true');
      res.status(201).json(SalaryAdjustmentResult.parse(value));
    });
  });

  router.post(PATHS.employeeSalaryAdjustmentRequests, noStore, authenticated, async (req, res) => {
    if (principalOf(res).role !== 'SCOPED') throw new ApiError(403, 'FORBIDDEN');
    const key = idempotencyKey(req);
    const confirmation = body(SalaryAdjustmentConfirmation, req.body);
    await guarded(async () => {
      const { value, replayed } = await service.submitRequest(principalOf(res), param(req, 'employeeCode'), confirmation, key);
      if (replayed) res.set('Idempotency-Replayed', 'true');
      res.status(201).json(SalaryRequestResponse.parse({ request: value }));
    });
  });

  router.get(PATHS.salaryAdjustmentRequests, noStore, authenticated, async (req, res) => {
    const query = body(SalaryRequestListQuery, req.query);
    await guarded(async () => {
      res.json(SalaryRequestList.parse(await service.listRequests(principalOf(res), query)));
    });
  });

  router.get(PATHS.salaryAdjustmentRequest, noStore, authenticated, async (req, res) => {
    await guarded(async () => {
      res.json(SalaryRequestResponse.parse({ request: await service.getRequest(principalOf(res), param(req, 'requestId')) }));
    });
  });

  router.post(PATHS.salaryAdjustmentRequestApprove, noStore, authenticated, async (req, res) => {
    if (principalOf(res).role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN');
    const key = idempotencyKey(req);
    await guarded(async () => {
      const { value, replayed } = await service.approve(principalOf(res), param(req, 'requestId'), key);
      if (replayed) res.set('Idempotency-Replayed', 'true');
      res.json(SalaryRequestApproval.parse(value));
    });
  });

  router.post(PATHS.salaryAdjustmentRequestCancel, noStore, authenticated, async (req, res) => {
    if (principalOf(res).role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN');
    const key = idempotencyKey(req);
    const { note } = body(SalaryRequestCancellation, req.body);
    await guarded(async () => {
      const { value, replayed } = await service.cancel(principalOf(res), param(req, 'requestId'), note, key);
      if (replayed) res.set('Idempotency-Replayed', 'true');
      res.json(SalaryRequestResponse.parse({ request: value }));
    });
  });

  return router;
}
