'use server';

import { refresh } from 'next/cache';

import { MAX_REVIEW_NOTE, VERDICTS, isUuid, type McpDetail, type TraceDetail, type TraceReview } from '@/lib/ai-monitoring';
import { api, type ApiResult } from '@/server/api/client';
import { readSessionToken } from '@/server/session-cookie';

// Admin AI-monitoring actions. Each is an untrusted entry point: it validates its input, adds the
// server-held session token, and lets the backend decide. The backend checks current Admin HR
// authority in MySQL on every call, so a Scoped HR request gets FORBIDDEN here too. Raw trace data
// is returned only to the component that asked for it after the warning; it is never logged,
// cached, or put in a URL.

export type AdminErrorCode =
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID'
  /** 409 STALE_VERSION: another review was saved first. */
  | 'STALE'
  /** 409 ASSISTANT_TURN_IN_PROGRESS: the trace has not finished. */
  | 'IN_PROGRESS'
  | 'UNAVAILABLE'
  | 'UNREADABLE';

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): AdminErrorCode {
  switch (result.kind) {
    case 'UNAUTHENTICATED':
      return 'SESSION_EXPIRED';
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'VALIDATION_ERROR':
      return 'INVALID';
    case 'STALE_VERSION':
      return 'STALE';
    case 'ASSISTANT_TURN_IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'INVALID_RESPONSE':
      return 'UNREADABLE';
    default:
      return 'UNAVAILABLE';
  }
}

export type RawTraceResult = { ok: true; detail: TraceDetail } | { ok: false; error: AdminErrorCode };
export type RawMcpResult = { ok: true; detail: McpDetail } | { ok: false; error: AdminErrorCode };

/** The exact stored JSON of one trace (view=raw). Called only after the warning is accepted. */
export async function loadRawTrace(traceId: unknown): Promise<RawTraceResult> {
  if (!isUuid(traceId)) return { ok: false, error: 'NOT_FOUND' };
  const token = await readSessionToken();
  if (!token) return { ok: false, error: 'SESSION_EXPIRED' };
  const result = await api().getAdminAiTrace(token, traceId, 'raw');
  if (!result.ok) return { ok: false, error: failure(result) };
  // The raw view must say it is raw; anything else is not shown as raw evidence.
  if (result.data.view !== 'raw') return { ok: false, error: 'UNREADABLE' };
  return { ok: true, detail: result.data };
}

export async function loadRawMcpCall(mcpCallId: unknown): Promise<RawMcpResult> {
  if (!isUuid(mcpCallId)) return { ok: false, error: 'NOT_FOUND' };
  const token = await readSessionToken();
  if (!token) return { ok: false, error: 'SESSION_EXPIRED' };
  const result = await api().getAdminMcpToolCall(token, mcpCallId, 'raw');
  if (!result.ok) return { ok: false, error: failure(result) };
  if (result.data.view !== 'raw') return { ok: false, error: 'UNREADABLE' };
  return { ok: true, detail: result.data };
}

export type ReviewResult =
  | { ok: true; review: TraceReview }
  /** On STALE, `current` is the review now saved (re-read from the backend), when it could be read. */
  | { ok: false; error: AdminErrorCode; current?: TraceReview | null };

export async function saveTraceReview(input: unknown): Promise<ReviewResult> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'INVALID' };
  const { traceId, verdict, note, nominated, expectedVersion } = input as Record<string, unknown>;
  if (
    !isUuid(traceId) ||
    !(VERDICTS as readonly unknown[]).includes(verdict) ||
    typeof note !== 'string' ||
    note.length > MAX_REVIEW_NOTE ||
    typeof nominated !== 'boolean' ||
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    return { ok: false, error: 'INVALID' };
  }
  const token = await readSessionToken();
  if (!token) return { ok: false, error: 'SESSION_EXPIRED' };
  const client = api();
  const result = await client.reviewAdminAiTrace(token, traceId, { verdict: verdict as TraceReview['verdict'], note, nominated, expectedVersion });
  if (result.ok) {
    refresh();
    return { ok: true, review: result.data.review };
  }
  const error = failure(result);
  if (error === 'STALE') {
    const latest = await client.getAdminAiTrace(token, traceId, 'formatted');
    return { ok: false, error, current: latest.ok ? latest.data.review : undefined };
  }
  return { ok: false, error };
}

export type DeleteResult =
  | { ok: true; deleted: { modelCalls: number; toolCalls: number; messages: number; review: boolean } }
  | { ok: false; error: AdminErrorCode };

export async function deleteTrace(traceId: unknown): Promise<DeleteResult> {
  if (!isUuid(traceId)) return { ok: false, error: 'NOT_FOUND' };
  const token = await readSessionToken();
  if (!token) return { ok: false, error: 'SESSION_EXPIRED' };
  const result = await api().deleteAdminAiTrace(token, traceId);
  if (!result.ok) return { ok: false, error: failure(result) };
  // Only the backend's confirmation of this exact trace counts as a deletion.
  if (result.data.deleted.traceId !== traceId) return { ok: false, error: 'UNREADABLE' };
  const { modelCalls, toolCalls, messages, review } = result.data.deleted;
  return { ok: true, deleted: { modelCalls, toolCalls, messages, review } };
}
