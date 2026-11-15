// Express application factory. Every dependency is injected; creating the app
// opens no listener and no database connection.
import express from 'express';
import type { Express } from 'express';

import type { AuthService } from '../access/sessions.js';
import type { AssistantService } from '../assistant/assistant-service.js';
import type { ToolRegistry } from '../assistant/tools.js';
import type { DirectoryService } from '../directory/directory-repository.js';
import { assistantRoutes } from './assistant-routes.js';
import { authRoutes } from './auth-routes.js';
import { HealthResponse, PATHS } from './contract.js';
import { directoryRoutes } from './directory-routes.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { mcpRoutes } from './mcp-routes.js';
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
  /** The read-only tools, exposed through MCP (the assistant holds its own reference). */
  tools: ToolRegistry;
  /** As-of clock for MCP tool calls; defaults to the system clock. */
  toolClock?: () => Date;
  /** Injected so tests can inspect the assistant limiter; defaults to a new in-memory store. */
  assistantRateLimitStore?: ClockedMemoryStore;
}

export function createApp({
  auth, directory, assistant, tools, logger, clientIpSource, clock = () => new Date(), rateLimitStore, toolClock, assistantRateLimitStore,
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // Never derive req.ip from forwarded headers; see rate-limit.ts.
  app.set('trust proxy', false);

  app.use(requestLog(logger));
  // These two routes authenticate first, then parse their bodies with their
  // own limits, so they are mounted before the app-wide 10 kB parser.
  // The assistant cost limit applies to the assistant route only.
  app.use(assistantRoutes({ auth, assistant, limiter: assistantRequestLimiter({ clock, store: assistantRateLimitStore }) }));
  app.use(mcpRoutes({ auth, tools, logger, clock: toolClock }));
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

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
