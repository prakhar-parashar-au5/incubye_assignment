// Dashboard analytics routes: authentication, strict query validation, then
// the permission-aware service. Read-only. Logs record only the route pattern.
import { Router } from 'express';
import type { RequestHandler } from 'express';

import type { AuthService } from '../access/sessions.js';
import type { DashboardService } from '../dashboard/dashboard-service.js';
import { errorCode } from '../errors.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import {
  DashboardBreakdownQuery,
  DashboardBreakdownResponse,
  DashboardRecentChangesQuery,
  DashboardRecentChangesResponse,
  DashboardSummaryQuery,
  DashboardSummaryResponse,
  DashboardWithoutAdjustmentQuery,
  DashboardWithoutAdjustmentResponse,
  PATHS,
} from './contract.js';
import { ApiError } from './errors.js';

const UNAVAILABLE_CODES = new Set(['ER_LOCK_WAIT_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR']);

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
  return parsed.data;
}

async function unavailableOnDatabaseFailure<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = errorCode(error);
    if (code !== undefined && UNAVAILABLE_CODES.has(code)) throw new ApiError(503, 'SERVICE_UNAVAILABLE');
    throw error;
  }
}

export function dashboardRoutes({ auth, dashboard }: { auth: AuthService; dashboard: DashboardService }): Router {
  const router = Router();
  const authenticated = requireAuth(auth);
  const principalOf = (res: { locals: unknown }) => (res.locals as AuthLocals).principal;

  router.get(PATHS.dashboardSummary, noStore, authenticated, async (req, res) => {
    const query = parse(DashboardSummaryQuery, req.query);
    res.json(DashboardSummaryResponse.parse(await unavailableOnDatabaseFailure(() => dashboard.summary(principalOf(res), query))));
  });

  router.get(PATHS.dashboardBreakdowns, noStore, authenticated, async (req, res) => {
    const query = parse(DashboardBreakdownQuery, req.query);
    res.json(DashboardBreakdownResponse.parse(await unavailableOnDatabaseFailure(() => dashboard.breakdowns(principalOf(res), query))));
  });

  router.get(PATHS.dashboardRecentChanges, noStore, authenticated, async (req, res) => {
    const query = parse(DashboardRecentChangesQuery, req.query);
    res.json(DashboardRecentChangesResponse.parse(await unavailableOnDatabaseFailure(() => dashboard.recentChanges(principalOf(res), query))));
  });

  router.get(PATHS.dashboardWithoutRecentAdjustment, noStore, authenticated, async (req, res) => {
    const query = parse(DashboardWithoutAdjustmentQuery, req.query);
    res.json(DashboardWithoutAdjustmentResponse.parse(await unavailableOnDatabaseFailure(() => dashboard.withoutRecentAdjustment(principalOf(res), query))));
  });

  return router;
}
