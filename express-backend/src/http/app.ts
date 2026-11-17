// Express application factory. Every dependency is injected; creating the app
// opens no listener and no database connection.
import express from 'express';
import type { Express } from 'express';

import type { HrAccessService } from '../access/hr-access-service.js';
import type { AuthService } from '../access/sessions.js';
import type { AssistantService } from '../assistant/assistant-service.js';
import type { AssistantStore } from '../assistant/assistant-store.js';
import { createConversationService } from '../assistant/conversation-service.js';
import type { SalaryAdjustmentService } from '../compensation/salary-adjustment-service.js';
import type { DashboardService } from '../dashboard/dashboard-service.js';
import type { ToolRegistry } from '../assistant/tools.js';
import type { DirectoryService } from '../directory/directory-repository.js';
import { adminObservabilityRoutes } from './admin-observability-routes.js';
import type { AdminObservabilityStore } from './admin-observability-routes.js';
import { assistantRoutes } from './assistant-routes.js';
import { authRoutes } from './auth-routes.js';
import { HealthResponse, PATHS } from './contract.js';
import { dashboardRoutes } from './dashboard-routes.js';
import { directoryRoutes } from './directory-routes.js';
import { hrAccessRoutes } from './hr-access-routes.js';
import { salaryRoutes } from './salary-routes.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { mcpRoutes } from './mcp-routes.js';
import type { McpCallStore } from './mcp-routes.js';
import { buildOpenApiDocument } from './openapi.js';
import { assistantRequestLimiter, failedLoginLimiter } from './rate-limit.js';
import type { ClientIpSource, ClockedMemoryStore } from './rate-limit.js';
import { requestLog } from './request-log.js';
import type { Logger } from './request-log.js';

export const JSON_BODY_LIMIT = '10kb';

export interface AppDependencies {
  auth: AuthService;
  logger: Logger;
  clientIpSource: ClientIpSource;
  /** Injected for the rate-limit window; defaults to the system clock. */
  clock?: () => Date;
  /** Injected so tests can inspect limiter state; defaults to a new in-memory store. */
  rateLimitStore?: ClockedMemoryStore;
  directory: DirectoryService;
  /** The in-product assistant. Reports unavailable when no model is configured. */
  assistant: AssistantService;
  /** Conversation and trace storage for the assistant (the MySQL observability repository in production). */
  assistantStore: AssistantStore;
  /** Clock for conversation times and the assistant as-of date; defaults to the system clock. */
  assistantClock?: () => Date;
  /** The read-only tools, exposed through MCP (the assistant holds its own reference). */
  tools: ToolRegistry;
  /** As-of clock for MCP tool calls; defaults to the system clock. */
  toolClock?: () => Date;
  /** Injected so tests can inspect the assistant limiter; defaults to a new in-memory store. */
  assistantRateLimitStore?: ClockedMemoryStore;
  /** Salary adjustments: preview, direct apply, requests, approval, cancellation. */
  salaryAdjustments: SalaryAdjustmentService;
  /** Read-only, permission-aware dashboard analytics. */
  dashboard: DashboardService;
  /** Admin-only HR access management. */
  hrAccess: HrAccessService;
  /** MCP call recording (the MySQL observability repository in production). */
  mcpStore: McpCallStore;
  /** Admin AI observability read model (the MySQL admin repository in production). */
  adminObservability: AdminObservabilityStore;
}

export function createApp({
  auth, directory, assistant, assistantStore, assistantClock, tools, salaryAdjustments, dashboard, hrAccess, adminObservability, mcpStore, logger, clientIpSource, clock = () => new Date(), rateLimitStore, toolClock, assistantRateLimitStore,
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // Never derive req.ip from forwarded headers; see rate-limit.ts.
  app.set('trust proxy', false);

  app.use(requestLog(logger));
  // These two routes authenticate first, then parse their bodies with their
  // own limits, so they are mounted before the app-wide 10 kB parser.
  // The assistant cost limit applies to message submission only (both routes share one limiter).
  const conversations = createConversationService({ store: assistantStore, assistant, logger, ...(assistantClock === undefined ? {} : { clock: assistantClock }) });
  app.use(assistantRoutes({ auth, conversations, limiter: assistantRequestLimiter({ clock, store: assistantRateLimitStore }) }));
  app.use(mcpRoutes({ auth, tools, store: mcpStore, logger, clock: toolClock }));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.get(PATHS.health, (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok' }));
  });

  const openApiDocument = buildOpenApiDocument();
  app.get(PATHS.openapi, (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(authRoutes({ auth, loginLimiter: failedLoginLimiter({ clientIpSource, clock, store: rateLimitStore }) }));
  app.use(directoryRoutes({ auth, directory }));
  app.use(salaryRoutes({ auth, salaryAdjustments }));
  app.use(dashboardRoutes({ auth, dashboard }));
  app.use(hrAccessRoutes({ auth, hrAccess }));
  app.use(adminObservabilityRoutes({ auth, store: adminObservability, logger, ...(assistantClock === undefined ? {} : { clock: assistantClock }) }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
