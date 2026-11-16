import type { components } from "@/generated/api";

// Assistant conversation rules and display safety, shared by the Server Action (enforcement) and
// the page (presentation). Limits mirror AssistantMessagesRequest in the generated contract and
// are asserted against it in tests.

type Schemas = components["schemas"];
export type ChatMessage = Schemas["AssistantMessagesRequest"]["messages"][number];
export type AssistantReply = Schemas["AssistantMessagesResponse"];
export type AssistantCard = Schemas["AssistantCard"];

export const MAX_MESSAGES = 10;
export const MAX_MESSAGE_LENGTH = 2000;

export const SUGGESTED_PROMPTS = [
  { label: "Top compensation", prompt: "Who are the five employees with the highest annual cash compensation?" },
  { label: "Recent changes", prompt: "What compensation changes were recorded in the last 90 days?" },
  { label: "Employee lookup", prompt: "Find employees named Sneha and show their current compensation." },
  { label: "Summary", prompt: "Summarize annual base salary by department." },
] as const;

/** The most recent messages that fit the backend limit, always ending with the user's message. */
export function conversationWindow(messages: readonly ChatMessage[]): ChatMessage[] {
  const window = messages.slice(-MAX_MESSAGES);
  // The backend requires the first message it sees to be from the user only implicitly (the
  // final one must be); starting on a user turn keeps question and answer pairs intact.
  while (window.length > 1 && window[0].role !== "user") window.shift();
  return window;
}

export type AssistantScope = { role: "ADMIN" | "SCOPED"; countries: readonly string[]; departments: readonly string[] };

function inScope(scope: AssistantScope, country: string, department: string): boolean {
  if (scope.role === "ADMIN") return true;
  return scope.countries.includes(country) && scope.departments.includes(department);
}

/**
 * Defence in depth. The backend tools are already permission-filtered; this drops any employee or
 * change row that falls outside the signed-in Scoped HR user's countries AND departments, so a
 * backend or model mistake still cannot put an out-of-scope record on screen.
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
