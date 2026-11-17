'use server';

import { refresh } from 'next/cache';

import { MAX_MESSAGE_LENGTH, isIdempotencyKey, isUuid } from '@/lib/assistant';
import { api, type ApiResult } from '@/server/api/client';
import { readSessionToken } from '@/server/session-cookie';

// The browser sends one new message, a conversation reference, and an idempotency key it created
// for this submission. This action adds the session token on the server and calls the backend; the
// browser never sees the token, and it never sends earlier messages. The saved conversation is the
// only history: after any outcome that may have changed it, the current page is re-rendered from
// the backend in the same response (refresh), so the thread on screen is always server state.

export type SendErrorCode =
  | 'SESSION_EXPIRED'
  /** 400: message rejected (length, key, or retry reference). Nothing was recorded. */
  | 'INVALID_MESSAGE'
  /** 404: the conversation does not exist or is not this user's. */
  | 'CONVERSATION_NOT_FOUND'
  | 'RATE_LIMITED'
  /** 409 DUPLICATE_OPERATION: the same key was used for different content. */
  | 'DUPLICATE_OPERATION'
  /** 409 ASSISTANT_TURN_IN_PROGRESS: this submission is still running on the server. */
  | 'IN_PROGRESS'
  /** 502 or 503 after the message was recorded: the failed turn is part of the saved thread. */
  | 'RECORDED_FAILURE'
  /** 503 with storage unavailable: nothing may have been recorded. */
  | 'STORAGE_UNAVAILABLE'
  /** No usable answer from the backend (timeout, network, unreadable): the outcome is unknown. */
  | 'UNCONFIRMED';

export type SendInput = {
  /** null starts a new conversation. */
  conversationId: string | null;
  content: string;
  idempotencyKey: string;
  /** Set only for a user-selected Retry of a failed turn (always with a new key). */
  retryOfTraceId?: string;
};

export type SendResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: SendErrorCode; conversationId: string | null; retryAfterSeconds?: number };

function parse(input: unknown): SendInput | null {
  if (!input || typeof input !== 'object') return null;
  const { conversationId, content, idempotencyKey, retryOfTraceId } = input as Record<string, unknown>;
  if (conversationId !== null && !isUuid(conversationId)) return null;
  if (typeof content !== 'string') return null;
  const text = content.trim();
  if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) return null;
  if (!isIdempotencyKey(idempotencyKey)) return null;
  if (retryOfTraceId !== undefined && (!isUuid(retryOfTraceId) || conversationId === null)) return null;
  return { conversationId, content: text, idempotencyKey, ...(retryOfTraceId ? { retryOfTraceId } : {}) };
}

function mapFailure(result: Extract<ApiResult<unknown>, { ok: false }>): SendErrorCode {
  switch (result.kind) {
    case 'UNAUTHENTICATED':
      return 'SESSION_EXPIRED';
    case 'VALIDATION_ERROR':
      return 'INVALID_MESSAGE';
    case 'NOT_FOUND':
      return 'CONVERSATION_NOT_FOUND';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'DUPLICATE_OPERATION':
      return 'DUPLICATE_OPERATION';
    case 'ASSISTANT_TURN_IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'MODEL_PROVIDER_FAILED':
      return 'RECORDED_FAILURE';
    case 'ASSISTANT_UNAVAILABLE':
      // TRACE_UNAVAILABLE: required recording failed, so the turn may not exist. The others
      // (MODEL_NOT_CONFIGURED, TURN_TIMEOUT) are recorded as a FAILED turn.
      return result.reason === 'TRACE_UNAVAILABLE' ? 'STORAGE_UNAVAILABLE' : 'RECORDED_FAILURE';
    default:
      return 'UNCONFIRMED';
  }
}

export async function sendConversationMessage(input: unknown): Promise<SendResult> {
  const command = parse(input);
  if (!command) return { ok: false, error: 'INVALID_MESSAGE', conversationId: null };

  const token = await readSessionToken();
  if (!token) return { ok: false, error: 'SESSION_EXPIRED', conversationId: command.conversationId };

  const client = api();
  let conversationId = command.conversationId;
  const existing = conversationId !== null;
  if (conversationId === null) {
    const created = await client.createAssistantConversation(token);
    if (!created.ok) {
      const error = created.kind === 'UNAUTHENTICATED' ? 'SESSION_EXPIRED' : created.kind === 'ASSISTANT_UNAVAILABLE' ? 'STORAGE_UNAVAILABLE' : 'UNCONFIRMED';
      return { ok: false, error, conversationId: null };
    }
    conversationId = created.data.conversation.conversationId;
  }

  const body = { content: command.content, ...(command.retryOfTraceId ? { retryOfTraceId: command.retryOfTraceId } : {}) };
  const result = await client.sendAssistantConversationMessage(token, conversationId, body, command.idempotencyKey);
  // A new conversation is shown by navigating to it; an existing one is re-rendered here.
  if (existing) refresh();
  if (result.ok) return { ok: true, conversationId: result.data.conversationId };
  const error = mapFailure(result);
  return {
    ok: false,
    error,
    conversationId,
    ...(error === 'RATE_LIMITED' && result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
  };
}
