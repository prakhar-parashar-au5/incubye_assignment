import type { components } from "@/generated/api";

// Assistant conversation rules and display safety, shared by the Server Action (enforcement), the
// conversation pages (thread building), and the client composer (presentation). Limits mirror
// AssistantMessageRequest and the Idempotency-Key parameter in the generated contract and are
// asserted against it in tests.

type Schemas = components["schemas"];
export type AssistantCard = Schemas["AssistantCard"];
export type ConversationSummary = Schemas["AssistantConversationSummary"];
export type ConversationDetail = Schemas["AssistantConversationDetailResponse"];
export type ConversationMessage = Schemas["AssistantConversationMessage"];
export type ConversationTurn = Schemas["AssistantConversationTurn"];
export type SavedResponse = NonNullable<ConversationMessage["response"]>;
export type TurnError = NonNullable<ConversationTurn["error"]>;

export const MAX_MESSAGE_LENGTH = 2000;
export const CONVERSATION_PAGE_SIZE = 25;

/** The verbatim recording notice from docs_human/13-ai-observability.md. */
export const RECORDING_NOTICE =
  "Assistant conversations and tool results are recorded for 30 days for quality review. This demo uses synthetic employee data. Do not enter passwords, tokens, or real personal information.";

export const SUGGESTED_PROMPTS = [
  { label: "Top compensation", prompt: "Who are the five employees with the highest annual cash compensation?" },
  { label: "Recent changes", prompt: "What compensation changes were recorded in the last 90 days?" },
  { label: "Employee lookup", prompt: "Find employees named Sneha and show their current compensation." },
  { label: "Summary", prompt: "Summarize annual base salary by department." },
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value);
}

/** `?page=N` for the conversation list; anything else is page 1. */
export function conversationPage(value: string | string[] | undefined): number {
  return typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value) ? Number(value) : 1;
}

export type AssistantScope = { role: "ADMIN" | "SCOPED"; countries: readonly string[]; departments: readonly string[] };

function inScope(scope: AssistantScope, country: string, department: string): boolean {
  if (scope.role === "ADMIN") return true;
  return scope.countries.includes(country) && scope.departments.includes(department);
}

/**
 * Defence in depth. The backend tools are already permission-filtered, and a saved answer whose
 * recorded scope the current scope no longer covers is withheld by the backend. This still drops
 * any employee or change row outside the signed-in Scoped HR user's countries AND departments, so a
 * backend or model mistake cannot put an out-of-scope record on screen.
 */
export function filterCardsToScope(cards: readonly AssistantCard[], scope: AssistantScope): { cards: AssistantCard[]; removed: number } {
  if (scope.role === "ADMIN") return { cards: [...cards], removed: 0 };
  let removed = 0;
  const result: AssistantCard[] = [];
  for (const card of cards) {
    if (card.type === "employee_list") {
      const employees = card.employees.filter((row) => inScope(scope, row.country, row.department));
      removed += card.employees.length - employees.length;
      result.push({ ...card, employees });
    } else if (card.type === "recent_changes") {
      const changes = card.changes.filter((row) => inScope(scope, row.country, row.department));
      removed += card.changes.length - changes.length;
      result.push({ ...card, changes });
    } else if (card.type === "compensation_summary") {
      const groups = card.groups.filter((group) =>
        // Department groups are department names. Country and currency group labels are not
        // specified in the contract, so they are left as the backend's scoped aggregates.
        card.groupBy === "DEPARTMENT" ? scope.departments.includes(group.group) : true,
      );
      removed += card.groups.length - groups.length;
      result.push({ ...card, groups });
    } else {
      result.push(card);
    }
  }
  return { cards: result, removed };
}

export type ThreadItem =
  | { kind: "gap"; key: string }
  | { kind: "user"; key: string; sequence: number; text: string; createdAt: string }
  | { kind: "answer"; key: string; sequence: number; text: string; response: SavedResponse; rowsDropped: boolean }
  /** The backend hid this saved answer (scope no longer covers it). No cards, limitations, or Retry. */
  | { kind: "withheld"; key: string; sequence: number; text: string }
  | { kind: "in-progress"; key: string; traceId: string }
  /** `retryText` is the user's message to send again; null when that turn was already retried. */
  | { kind: "failed"; key: string; traceId: string; error: TurnError; retryText: string | null };

/**
 * Orders the saved conversation for display. Messages are placed strictly by their sequence numbers;
 * a missing number means a deleted or expired turn and becomes one "removed" marker. A user message
 * is followed by its turn's state when the turn failed or is still running.
 */
export function buildThread(detail: ConversationDetail, scope: AssistantScope): ThreadItem[] {
  const turns = new Map(detail.turns.map((turn) => [turn.traceId, turn]));
  const retried = new Set(detail.turns.flatMap((turn) => (turn.retryOfTraceId ? [turn.retryOfTraceId] : [])));
  const messages = [...detail.messages].sort((a, b) => a.sequence - b.sequence);
  const items: ThreadItem[] = [];
  let expected = 1;
  for (const message of messages) {
    if (message.sequence > expected) items.push({ kind: "gap", key: `gap-${message.sequence}` });
    expected = message.sequence + 1;
    const key = `m-${message.sequence}`;
    if (message.role === "user") {
      items.push({ kind: "user", key, sequence: message.sequence, text: message.text, createdAt: message.createdAt });
      const turn = message.traceId ? turns.get(message.traceId) : undefined;
      if (turn?.status === "STARTED") items.push({ kind: "in-progress", key: `t-${turn.traceId}`, traceId: turn.traceId });
      if (turn?.status === "FAILED") {
        items.push({
          kind: "failed",
          key: `t-${turn.traceId}`,
          traceId: turn.traceId,
          error: turn.error ?? { code: "INTERNAL_ERROR", message: "", reason: null },
          retryText: retried.has(turn.traceId) ? null : message.text,
        });
      }
    } else if (message.withheld || message.response === null) {
      items.push({ kind: "withheld", key, sequence: message.sequence, text: message.text });
    } else {
      const { cards, removed } = filterCardsToScope(message.response.cards, scope);
      items.push({ kind: "answer", key, sequence: message.sequence, text: message.text, response: { ...message.response, cards }, rowsDropped: removed > 0 });
    }
  }
  return items;
}

/** Plain-language title and guidance for a recorded failed turn. Codes come from the contract enum. */
export function failedTurnText(error: Pick<TurnError, "code" | "reason">): { title: string; body: string } {
  if (error.code === "ASSISTANT_UNAVAILABLE") {
    if (error.reason === "MODEL_NOT_CONFIGURED") {
      return {
        title: "The assistant is not configured",
        body: "No language model is set up in this environment, so nothing was answered. Your message was saved. The employee directory still works.",
      };
    }
    if (error.reason === "TURN_TIMEOUT") return { title: "The assistant took too long to answer", body: "Nothing was answered. Retry, or ask a narrower question." };
    return { title: "The assistant is unavailable", body: "Nothing was answered. The employee directory still works." };
  }
  if (error.code === "MODEL_PROVIDER_FAILED") {
    if (error.reason === "MODEL_TIMEOUT") return { title: "The language model took too long to answer", body: "Your message was saved. Select Retry to try again." };
    if (error.reason === "MODEL_RATE_LIMITED") return { title: "The language model is busy", body: "Your message was saved. Wait a moment, then select Retry." };
    return { title: "The language model did not answer", body: "Your message was saved. Select Retry to try again." };
  }
  return { title: "This message was not answered", body: "Your message was saved. Select Retry to try again." };
}

export function conversationLabel(summary: Pick<ConversationSummary, "title">): string | null {
  const title = summary.title?.trim();
  return title ? title : null;
}

export const TOOL_LABELS: Record<string, string> = {
  search_employees: "Searched employees",
  get_employee_compensation: "Looked up an employee's compensation",
  get_top_compensated_employees: "Ranked employees by compensation",
  get_recent_compensation_changes: "Checked recent compensation changes",
  get_compensation_summary: "Summarized compensation",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "Used a data tool";
}
