import express, { Router } from 'express';
import type { RequestHandler } from 'express';

import { AssistantUnavailableError } from '../assistant/assistant-service.js';
import type { AssistantService } from '../assistant/assistant-service.js';
import type { AuthService } from '../access/sessions.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import { AssistantMessagesRequest, AssistantMessagesResponse, PATHS } from './contract.js';
import { ApiError } from './errors.js';

/** 10 messages x 2,000 characters x up to 4 UTF-8 bytes, plus JSON overhead. */
export const ASSISTANT_BODY_LIMIT = '96kb';

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/**
 * Mounted before the app-wide 10 kB JSON parser: authentication runs first,
 * then the per-user request limit, then this route's own larger parser.
 */
export function assistantRoutes({ auth, assistant, limiter }: { auth: AuthService; assistant: AssistantService; limiter: RequestHandler }): Router {
  const router = Router();

  router.post(PATHS.assistantMessages, noStore, requireAuth(auth), limiter, express.json({ limit: ASSISTANT_BODY_LIMIT, strict: true }), async (req, res) => {
    const parsed = AssistantMessagesRequest.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
    if (!assistant.available) throw new ApiError(503, 'ASSISTANT_UNAVAILABLE');
    const { principal } = res.locals as AuthLocals;
    try {
      const reply = await assistant.ask(principal, parsed.data.messages, String(res.locals.requestId ?? ''));
      res.json(AssistantMessagesResponse.parse(reply));
    } catch (error) {
      if (error instanceof AssistantUnavailableError) throw new ApiError(503, 'ASSISTANT_UNAVAILABLE');
      throw error;
    }
  });

  return router;
}
