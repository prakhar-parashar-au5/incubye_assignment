// Express application factory. Every dependency is injected; creating the app
// opens no listener and no database connection.
import express from 'express';
import type { Express } from 'express';

import type { AuthService } from '../access/sessions.js';
import { authRoutes } from './auth-routes.js';
import { HealthResponse, PATHS } from './contract.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { buildOpenApiDocument } from './openapi.js';
import { failedLoginLimiter } from './rate-limit.js';
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
}

export function createApp({ auth, logger, clientIpSource, clock = () => new Date(), rateLimitStore }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // Never derive req.ip from forwarded headers; see rate-limit.ts.
  app.set('trust proxy', false);

  app.use(requestLog(logger));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.get(PATHS.health, (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok' }));
  });

  const openApiDocument = buildOpenApiDocument();
  app.get(PATHS.openapi, (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(authRoutes({ auth, loginLimiter: failedLoginLimiter({ clientIpSource, clock, store: rateLimitStore }) }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
