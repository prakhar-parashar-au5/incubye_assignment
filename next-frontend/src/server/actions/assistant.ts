'use server';

import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, conversationWindow, filterCardsToScope, type AssistantReply, type ChatMessage } from '@/lib/assistant';
import { api } from '@/server/api/client';
import { getSession } from '@/server/session';
import { readSessionToken } from '@/server/session-cookie';

// The browser sends the conversation here; this action adds the session token on the server and
// calls the backend. The browser never sees the token, and nothing is stored.

export type AssistantErrorCode =
  | 'SESSION_EXPIRED'
  | 'INVALID_CONVERSATION'
  | 'ASSISTANT_UNAVAILABLE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_RESPONSE';

export type AssistantResult =
  /** `withheld` says only that some rows were dropped; the count is never sent to the browser. */
  | { ok: true; reply: AssistantReply; withheld: boolean }
  | { ok: false; error: AssistantErrorCode };

function validConversation(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const messages: ChatMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const { role, content } = item as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    let text = content.trim();
    if (text.length === 0) return null;
    if (text.length > MAX_MESSAGE_LENGTH) {
      // Earlier assistant answers may be longer than the request limit; send their start only.
      // A user message over the limit is rejected, as the composer prevents it.
      if (role === 'user') return null;
      text = text.slice(0, MAX_MESSAGE_LENGTH);
    }
    messages.push({ role, content: text });
  }
  const window = conversationWindow(messages);
  if (window.length > MAX_MESSAGES || window.at(-1)?.role !== 'user') return null;
  return window;
}

export async function askAssistant(conversation: unknown): Promise<AssistantResult> {
  const messages = validConversation(conversation);
  if (!messages) return { ok: false, error: 'INVALID_CONVERSATION' };

  const token = await readSessionToken();
  if (!token) return { ok: false, error: 'SESSION_EXPIRED' };

  // Identity and scope come from the backend for this request, never from the client.
  const [session, result] = await Promise.all([getSession(), api().sendAssistantMessages(token, { messages })]);
  if (session.kind === 'signed-out' || session.kind === 'expired') return { ok: false, error: 'SESSION_EXPIRED' };

  if (!result.ok) {
    switch (result.kind) {
      case 'UNAUTHENTICATED':
        return { ok: false, error: 'SESSION_EXPIRED' };
      case 'VALIDATION_ERROR':
        return { ok: false, error: 'INVALID_CONVERSATION' };
      case 'ASSISTANT_UNAVAILABLE':
        return { ok: false, error: 'ASSISTANT_UNAVAILABLE' };
      case 'TIMEOUT':
        return { ok: false, error: 'TIMEOUT' };
      case 'RATE_LIMITED':
        return { ok: false, error: 'RATE_LIMITED' };
      case 'INVALID_RESPONSE':
        return { ok: false, error: 'INVALID_RESPONSE' };
      default:
        return { ok: false, error: 'SERVICE_UNAVAILABLE' };
    }
  }

  // Without a confirmed scope no tool data is shown.
  if (session.kind !== 'signed-in') return { ok: false, error: 'SERVICE_UNAVAILABLE' };
  const { cards, removed } = filterCardsToScope(result.data.cards, session.user);
  return { ok: true, reply: { ...result.data, cards }, withheld: removed > 0 };
}
