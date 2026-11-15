// Assistant evaluation cases, shared by:
//   - test/db/assistant-tools.test.ts: a fake model replays `toolCall`, and the
//     test checks the tool loop, the real tools, and permissions on MySQL;
//   - scripts/eval-assistant.ts: an optional manual run against the real
//     OpenAI model (needs OPENAI_API_KEY) that checks the model picks
//     `expectedTool`. Automated tests never call OpenAI.
import type { ToolName } from '../src/assistant/tool-schemas.js';

export interface AssistantEvalCase {
  id: string;
  question: string;
  /** The tool a correct model calls first, or null when no tool should run. */
  expectedTool: ToolName | null;
  /** The arguments the fake model sends (strict form: optional fields as null). */
  toolCall: Record<string, unknown> | null;
  /** Card types the tool returns on the seeded data. */
  expectedCards: readonly string[];
}

export const ASSISTANT_EVAL_CASES: readonly AssistantEvalCase[] = Object.freeze([
  {
    id: 'top-cash-mixed-currency',
    question: 'Who has the highest annual cash compensation?',
    expectedTool: 'get_top_compensated_employees',
    toolCall: { metric: 'ANNUAL_CASH', currency: null, comparisonCurrency: null, limit: 1 },
    expectedCards: ['employee_list'],
  },
  {
    id: 'top-base-inr',
    question: 'Show the top 3 annual base salaries paid in INR.',
    expectedTool: 'get_top_compensated_employees',
    toolCall: { metric: 'ANNUAL_BASE', currency: 'INR', comparisonCurrency: null, limit: 3 },
    expectedCards: ['employee_list'],
  },
  {
    id: 'search-by-name',
    question: 'Find Sneha Singh.',
    expectedTool: 'search_employees',
    toolCall: { query: 'Sneha Singh', limit: null },
    expectedCards: ['employee_list'],
  },
  {
    id: 'employee-history',
    question: 'What is the compensation history of ACME00001?',
    expectedTool: 'get_employee_compensation',
    toolCall: { employeeCode: 'ACME00001' },
    expectedCards: ['employee_list'],
  },
  {
    id: 'recent-changes',
    question: 'What new compensation changes were recorded in the last 30 days?',
    expectedTool: 'get_recent_compensation_changes',
    toolCall: { days: 30, limit: null, includeInitialImport: false },
    expectedCards: ['notice'],
  },
  {
    id: 'summary-by-department',
    question: 'What is the average base salary by department?',
    expectedTool: 'get_compensation_summary',
    toolCall: { groupBy: 'DEPARTMENT', metric: 'ANNUAL_BASE' },
    expectedCards: ['compensation_summary'],
  },
  {
    id: 'summary-by-currency',
    question: 'Total annual cash compensation by currency?',
    expectedTool: 'get_compensation_summary',
    toolCall: { groupBy: 'CURRENCY', metric: 'ANNUAL_CASH' },
    expectedCards: ['compensation_summary'],
  },
  {
    id: 'mutation-request',
    question: 'Give ACME00001 a 10% raise effective today.',
    expectedTool: null,
    toolCall: null,
    expectedCards: [],
  },
]);
