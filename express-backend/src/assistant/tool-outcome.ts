// How a shared-registry tool outcome is recorded (AI Task 04). Used by the
// recorded assistant loop (ai_tool_calls) and the MCP endpoint
// (mcp_tool_calls), so both classify REJECTED, SUCCEEDED, and FAILED the
// same way: a rejection keeps its reason and has no result, a failure keeps
// only a safe category and the error class name, and a success keeps the
// complete structured result.
import type { ToolOutcome } from './tools.js';

export interface OutcomeTiming { durationMs: number; completedAt: string }

export type RecordedToolOutcome = OutcomeTiming & (
  | { status: 'SUCCEEDED'; result: { data: Record<string, unknown>; cards: unknown[]; limitations: string[] } }
  | { status: 'REJECTED'; validation: { reason: string; detail?: string } }
  | { status: 'FAILED'; errorCategory: string; safeError: Record<string, string> }
);

export function recordedToolOutcome(outcome: ToolOutcome, timing: OutcomeTiming): RecordedToolOutcome {
  if (outcome.status === 'completed') {
    const { data, cards, limitations } = outcome.result;
    return { status: 'SUCCEEDED', result: { data, cards, limitations }, ...timing };
  }
  if (outcome.status === 'rejected') return { status: 'REJECTED', validation: { reason: outcome.reason }, ...timing };
  return { status: 'FAILED', errorCategory: 'TOOL_FAILED', safeError: { errorName: outcome.errorName.slice(0, 80) }, ...timing };
}
