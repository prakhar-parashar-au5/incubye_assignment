// Admin-only AI observability routes (AI Task 04). docs_human/13.
//
//   GET    /admin/ai-traces                 list (filters, newest first, 25 / max 100)
//   GET    /admin/ai-traces/options         filter choices and closed enumerations
//   GET    /admin/ai-traces/summary         monitoring aggregates for 24h, 7d, or 30d
//   GET    /admin/ai-traces/:traceId        detail (?view=formatted|raw)
//   POST   /admin/ai-traces/:traceId/review compare-and-set review
//   DELETE /admin/ai-traces/:traceId        ?confirm=<traceId>
//   GET    /admin/mcp-tool-calls            list
//   GET    /admin/mcp-tool-calls/:mcpCallId detail (?view=formatted|raw)
//
// Order on every request: requireAuth (current HR status and role from MySQL)
// -> active Admin HR, else 403 -> input validation -> storage. Logs carry only
// the request ID and operation name, never trace content or identities.
import { Router } from 'express';
import type { RequestHandler, Response } from 'express';

import type { AuthService } from '../access/sessions.js';
import type { AdminObservabilityRepository } from '../assistant/observability/admin-repository.js';
import { buildSummary, dbFromDate, isoFromDb, mcpDetail, mcpListItem, traceDetail, traceListItem, traceOptions } from '../assistant/observability/admin-service.js';
import { ConflictError } from '../assistant/observability/repository.js';
import { PersistenceValidationError } from '../assistant/observability/validation.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import {
  AdminMcpDetailResponse, AdminMcpListQuery, AdminMcpListResponse, AdminTraceDeleteQuery, AdminTraceDeleteResponse, AdminTraceDetailQuery,
  AdminTraceDetailResponse, AdminTraceListQuery, AdminTraceListResponse, AdminTraceOptionsResponse, AdminTraceReviewRequest, AdminTraceReviewResponse,
  AdminTraceSummaryQuery, AdminTraceSummaryResponse, PATHS,
} from './contract.js';
import { ApiError } from './errors.js';
import type { Logger } from './request-log.js';

export type AdminObservabilityStore = AdminObservabilityRepository;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
  return parsed.data;
}

/** UTC calendar dates to the stored DATETIME(3) bounds: [from 00:00, to + 1 day 00:00). */
function dateBounds(q: { from?: string | undefined; to?: string | undefined }): { from?: string; toExclusive?: string } {
  return {
    ...(q.from === undefined ? {} : { from: `${q.from} 00:00:00.000` }),
    ...(q.to === undefined ? {} : { toExclusive: dbFromDate(new Date(Date.parse(`${q.to}T00:00:00.000Z`) + DAY_MS)) }),
  };
}
const pageInfo = (page: number, size: number, total: number) => ({ number: page, size, totalRows: total, totalPages: Math.ceil(total / size) });

export function adminObservabilityRoutes({ auth, store, logger, clock = () => new Date() }: {
  auth: AuthService;
  store: AdminObservabilityStore;
  logger: Logger;
  clock?: () => Date;
}): Router {
  const router = Router();
  const principalOf = (res: Response) => (res.locals as AuthLocals).principal;
  const requireAdmin: RequestHandler = (_req, res, next) => {
    const principal = principalOf(res);
    if (principal.role !== 'ADMIN' || principal.status !== 'ACTIVE') throw new ApiError(403, 'FORBIDDEN');
    next();
  };
  const admin = [noStore, requireAuth(auth), requireAdmin];

  /** Storage failures become 503; the log names the operation only. */
  async function storage<T>(res: Response, operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ApiError || error instanceof ConflictError || error instanceof PersistenceValidationError) throw error;
      logger({ event: 'admin_observability_unavailable', requestId: String(res.locals.requestId ?? ''), operation });
      throw new ApiError(503, 'SERVICE_UNAVAILABLE');
    }
  }
  const traceNotFound = () => new ApiError(404, 'NOT_FOUND', 'Trace not found.');
  const mcpNotFound = () => new ApiError(404, 'NOT_FOUND', 'MCP call not found.');
  const idParam = (value: unknown, notFound: () => ApiError = traceNotFound): string => {
    if (typeof value !== 'string' || !UUID.test(value)) throw notFound();
    return value;
  };

  router.get(PATHS.adminAiTraces, ...admin, async (req, res) => {
    const q = parse(AdminTraceListQuery, req.query);
    const found = await storage(res, 'list_traces', () => store.listTraces({
      ...dateBounds(q),
      ...(q.hrUserId === undefined ? {} : { actorId: q.hrUserId }),
      ...(q.status === undefined ? {} : { status: q.status }),
      ...(q.model === undefined ? {} : { model: q.model }),
      ...(q.tool === undefined ? {} : { toolName: q.tool }),
      ...(q.errorCategory === undefined ? {} : { errorCategory: q.errorCategory }),
    }, { limit: q.pageSize, offset: (q.page - 1) * q.pageSize }));
    res.json(AdminTraceListResponse.parse({ traces: found.items.map(traceListItem), page: pageInfo(q.page, q.pageSize, found.total) }));
  });

  router.get(PATHS.adminAiTraceOptions, ...admin, async (req, res) => {
    parse(AdminTraceDetailQuery.pick({}), req.query);
    res.json(AdminTraceOptionsResponse.parse(traceOptions(await storage(res, 'trace_options', () => store.filterOptions()))));
  });

  router.get(PATHS.adminAiTraceSummary, ...admin, async (req, res) => {
    const { window } = parse(AdminTraceSummaryQuery, req.query);
    res.json(AdminTraceSummaryResponse.parse(await storage(res, 'trace_summary', () => buildSummary(store, window, clock()))));
  });

  router.get(PATHS.adminAiTrace, ...admin, async (req, res) => {
    const traceId = idParam(req.params.traceId);
    const { view } = parse(AdminTraceDetailQuery, req.query);
    const found = await storage(res, 'read_trace', () => store.readTrace(traceId));
    if (found === null) throw traceNotFound();
    res.json(AdminTraceDetailResponse.parse(traceDetail(found, view)));
  });

  router.post(PATHS.adminAiTraceReview, ...admin, async (req, res) => {
    const traceId = idParam(req.params.traceId);
    const body = parse(AdminTraceReviewRequest, req.body);
    let review;
    try {
      review = await storage(res, 'review_trace', () => store.reviewTrace({
        traceId, reviewerId: principalOf(res).hrUserId, verdict: body.verdict, note: body.note, nominated: body.nominated,
        expectedVersion: body.expectedVersion, now: dbFromDate(clock()),
      }));
    } catch (error) {
      if (error instanceof ConflictError && error.message === 'trace unavailable') throw traceNotFound();
      if (error instanceof ConflictError && error.message === 'trace in progress') throw new ApiError(409, 'ASSISTANT_TURN_IN_PROGRESS', 'The turn has not finished. Review it when it completes or fails.');
      if (error instanceof ConflictError) throw new ApiError(409, 'STALE_VERSION', 'Another review was saved. Reload the trace and try again.');
      if (error instanceof PersistenceValidationError) throw new ApiError(400, 'VALIDATION_ERROR');
      throw error;
    }
    res.json(AdminTraceReviewResponse.parse({ review: { ...review, createdAt: isoFromDb(review.createdAt), updatedAt: isoFromDb(review.updatedAt) } }));
  });

  router.delete(PATHS.adminAiTrace, ...admin, async (req, res) => {
    const traceId = idParam(req.params.traceId);
    const confirmed = AdminTraceDeleteQuery.safeParse(req.query);
    if (!confirmed.success || confirmed.data.confirm !== traceId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Confirm the deletion by sending ?confirm=<traceId> with the same trace ID.', 'DELETE_CONFIRMATION_REQUIRED');
    }
    const removed = await storage(res, 'delete_trace', () => store.deleteTrace(traceId));
    if (removed === null) throw traceNotFound();
    res.json(AdminTraceDeleteResponse.parse({ deleted: { traceId, ...removed } }));
  });

  router.get(PATHS.adminMcpCalls, ...admin, async (req, res) => {
    const q = parse(AdminMcpListQuery, req.query);
    const found = await storage(res, 'list_mcp_calls', () => store.listMcpCalls({
      ...dateBounds(q),
      ...(q.hrUserId === undefined ? {} : { actorId: q.hrUserId }),
      ...(q.tool === undefined ? {} : { toolName: q.tool }),
      ...(q.status === undefined ? {} : { status: q.status }),
    }, { limit: q.pageSize, offset: (q.page - 1) * q.pageSize }));
    res.json(AdminMcpListResponse.parse({ calls: found.items.map(mcpListItem), page: pageInfo(q.page, q.pageSize, found.total) }));
  });

  router.get(PATHS.adminMcpCall, ...admin, async (req, res) => {
    const callId = idParam(req.params.mcpCallId, mcpNotFound);
    const { view } = parse(AdminTraceDetailQuery, req.query);
    const found = await storage(res, 'read_mcp_call', () => store.readMcpCall(callId));
    if (found === null) throw mcpNotFound();
    res.json(AdminMcpDetailResponse.parse(mcpDetail(found, view)));
  });

  return router;
}
