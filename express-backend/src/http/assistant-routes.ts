// Assistant routes. Mounted before the app-wide 10 kB JSON parser:
// authentication runs first, then (for message submission) the per-user
// request limit, then the route's own parser.
//
// Authoritative path (AI Task 03): server-owned conversations.
//   GET  /assistant/conversations                         owned list
//   POST /assistant/conversations                         create
//   GET  /assistant/conversations/:conversationId         owned detail
//   POST /assistant/conversations/:conversationId/messages one message, Idempotency-Key
//
// Deprecated: POST /assistant/messages (browser-supplied history). Kept only
// so the current frontend keeps working until it moves to the conversation
// API (removal at Checkpoint C). Every call is a recorded turn in a new
// conversation using only the final user message; earlier browser messages
// are never sent to the model.
import express, { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';

import { AssistantApiError } from '../assistant/conversation-service.js';
import type { ConversationService } from '../assistant/conversation-service.js';
import type { AuthService } from '../access/sessions.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import {
  ASSISTANT_IDEMPOTENCY_KEY,
  AssistantConversationCreateRequest,
  AssistantConversationDetailResponse,
  AssistantConversationListQuery,
  AssistantConversationListResponse,
  AssistantConversationResponse,
  AssistantMessageRequest,
  AssistantMessagesRequest,
  AssistantMessagesResponse,
  AssistantTurnResponse,
  PATHS,
} from './contract.js';
import { ApiError } from './errors.js';

/** 10 messages x 2,000 characters x up to 4 UTF-8 bytes, plus JSON overhead. */
export const ASSISTANT_BODY_LIMIT = '96kb';
/** One message of 2,000 characters x up to 4 UTF-8 bytes, plus JSON overhead. */
export const ASSISTANT_MESSAGE_BODY_LIMIT = '12kb';
export const LEGACY_SUCCESSOR = `<${PATHS.assistantConversations}>; rel="successor-version"`;

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
  return parsed.data;
}

async function guarded<T>(res: Response, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AssistantApiError) {
      if (error.replayed) res.set('Idempotency-Replayed', 'true');
      throw new ApiError(error.status, error.code, error.publicMessage, error.reason);
    }
    throw error;
  }
}

const conversationIdOf = (req: Request): string => {
  const value = req.params.conversationId;
  return typeof value === 'string' ? value : '';
};

export function assistantRoutes({ auth, conversations, limiter }: { auth: AuthService; conversations: ConversationService; limiter: RequestHandler }): Router {
  const router = Router();
  const authenticated = requireAuth(auth);
  const principalOf = (res: Response) => (res.locals as AuthLocals).principal;
  const requestIdOf = (res: Response) => String(res.locals.requestId ?? '');

  router.get(PATHS.assistantConversations, noStore, authenticated, async (req, res) => {
    const query = parse(AssistantConversationListQuery, req.query);
    res.json(AssistantConversationListResponse.parse(await guarded(res, () => conversations.list(principalOf(res), query))));
  });

  router.post(PATHS.assistantConversations, noStore, authenticated, express.json({ limit: '1kb', strict: true }), async (req, res) => {
    parse(AssistantConversationCreateRequest, req.body ?? {});
    const conversation = await guarded(res, () => conversations.create(principalOf(res)));
    res.status(201).json(AssistantConversationResponse.parse({ conversation }));
  });

  router.get(PATHS.assistantConversation, noStore, authenticated, async (req, res) => {
    res.json(AssistantConversationDetailResponse.parse(await guarded(res, () => conversations.read(principalOf(res), conversationIdOf(req)))));
  });

  router.post(PATHS.assistantConversationMessages, noStore, authenticated, limiter, express.json({ limit: ASSISTANT_MESSAGE_BODY_LIMIT, strict: true }), async (req, res) => {
    const key = req.get('idempotency-key');
    if (key === undefined || !ASSISTANT_IDEMPOTENCY_KEY.test(key)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'An Idempotency-Key header of 16 to 100 letters, digits, "-" or "_" is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    }
    const body = parse(AssistantMessageRequest, req.body);
    const { value, replayed } = await guarded(res, () => conversations.submit(principalOf(res), conversationIdOf(req), body, key, requestIdOf(res)));
    if (replayed) res.set('Idempotency-Replayed', 'true');
    res.json(AssistantTurnResponse.parse(value));
  });

  // Deprecated compatibility route; see the header comment.
  router.post(PATHS.assistantMessages, noStore, authenticated, limiter, express.json({ limit: ASSISTANT_BODY_LIMIT, strict: true }), async (req, res) => {
    res.set('Deprecation', 'true');
    res.set('Link', LEGACY_SUCCESSOR);
    const { messages } = parse(AssistantMessagesRequest, req.body);
    const content = messages.at(-1)?.content ?? '';
    try {
      res.json(AssistantMessagesResponse.parse(await conversations.legacy(principalOf(res), content, requestIdOf(res))));
    } catch (error) {
      // The legacy contract has one failure response for every assistant problem.
      if (error instanceof AssistantApiError) throw new ApiError(503, 'ASSISTANT_UNAVAILABLE');
      throw error;
    }
  });

  return router;
}
