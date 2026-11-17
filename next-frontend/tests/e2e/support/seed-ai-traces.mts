// Test-only seed for the AI-monitoring browser journeys. The lane backend has no language model,
// so trace shapes a model would produce (no tool, several tools, a rejected and a failed tool, a
// provider timeout after a tool, an outcome that could not be recorded, a large result) are written
// through the backend's own observability repository, in the same order and with the same
// validation, scrubbing, and size limits the assistant uses. Nothing here changes backend code.
//
// Run with the backend's tsx, against an isolated *_test database only:
//   E2E_DATABASE_URL=mysql://…/acme_ai_traces_e2e_test npx --prefix ../express-backend tsx tests/e2e/support/seed-ai-traces.mts
// Prints one JSON line: { "conversationId": …, "traces": { "<shape>": "<traceId>" } }.
import { randomUUID } from "node:crypto";

import { createPool } from "../../../../express-backend/src/db/connection.ts";
import { createObservabilityRepository } from "../../../../express-backend/src/assistant/observability/repository.ts";

const url = process.env.E2E_DATABASE_URL ?? "";
const database = (() => {
  try {
    return new URL(url).pathname.slice(1);
  } catch {
    return "";
  }
})();
if (!/_test$/.test(database)) {
  console.error("Refusing to seed: E2E_DATABASE_URL must name a database ending in _test.");
  process.exit(2);
}

const pool = createPool(url, { connectionLimit: 2 });
const repo = createObservabilityRepository(pool);
const PROMPT = { promptVersion: "assistant-instructions-v1", promptHash: "a".repeat(64) };
const MODEL = "e2e-scripted-model";

let clock = Date.now() - 60 * 60 * 1000;
const at = (advanceMs = 0) => {
  clock += advanceMs;
  return new Date(clock).toISOString().replace("T", " ").replace("Z", "");
};

const TOOLS = [{ name: "search_employees" }, { name: "get_top_compensated_employees" }];
const sneha = { employeeCode: "ACME00042", name: "Sneha Singh", department: "Tech", country: "IN", annualBaseSalary: { amount: "2500000.00", currency: "INR" } };
const marcus = { employeeCode: "ACME00010", name: "Marcus Thompson", department: "Tech", country: "US", annualBaseSalary: { amount: "150000.00", currency: "USD" } };

function answer(text: string) {
  return { answer: text, toolCalls: [], cards: [], limitations: [], generatedAt: new Date(clock).toISOString() };
}

async function main() {
  const [users] = await pool.query("SELECT id FROM hr_users WHERE email = 'meera.iyer@acme.com'");
  const actorId = Number((users as { id: number }[])[0]?.id);
  if (!actorId) throw new Error("demo user missing: run db:seed-demo-users first");
  const conversation = await repo.createConversation(actorId, at());
  const traces: Record<string, string> = {};
  let previous: string | undefined;

  async function trace(shape: string, text: string) {
    const created = await repo.createTrace({
      conversationId: conversation.id,
      actorId,
      requestId: randomUUID(),
      ...(previous ? { previousTraceId: previous } : {}),
      ...PROMPT,
      model: MODEL,
      userContent: { text, retryOfTraceId: null },
      modelMessages: [{ role: "user", content: text }],
      startedAt: at(1000),
      actorScope: { role: "ADMIN", countries: [], departments: [] },
    });
    traces[shape] = created.id;
    previous = created.id;
    return created.id;
  }
  async function modelCall(traceId: string, outcome: Omit<Parameters<typeof repo.finishModelCall>[1], "completedAt">) {
    const call = await repo.startModelCall({ traceId, provider: "scripted", model: MODEL, input: [{ role: "user", content: "…" }], tools: TOOLS, ...PROMPT, startedAt: at(5) });
    await repo.finishModelCall(call.id, { ...outcome, completedAt: at(outcome.latencyMs) });
    return call.id;
  }

  // 1. No tool: one model call answers directly.
  let id = await trace("noTool", "Say hello to the HR team.");
  await modelCall(id, { status: "SUCCEEDED", output: { text: "Hello, HR team." }, decisions: [], inputTokens: 120, outputTokens: 12, reasoningTokens: 0, latencyMs: 640 });
  await repo.finishTrace(id, { status: "COMPLETED", finalResponse: answer("Hello, HR team."), durationMs: 700, completedAt: at(60) });

  // 2. Several tools: one succeeds (employee identities and salaries), one is rejected with a
  // password-named argument (scrubbed before storage), then a second model call answers.
  id = await trace("multiTool", "Who are the top earners in Tech?");
  let call = await modelCall(id, {
    status: "SUCCEEDED",
    output: null,
    decisions: [{ name: "get_top_compensated_employees", id: "call_1" }, { name: "search_employees", id: "call_2" }],
    inputTokens: 900,
    outputTokens: 40,
    reasoningTokens: 64,
    latencyMs: 1200,
  });
  let tool = await repo.startToolCall({ traceId: id, modelCallId: call, toolName: "get_top_compensated_employees", arguments: { department: "Tech", limit: 2 }, startedAt: at(5), providerToolCallId: "call_1" });
  await repo.finishToolCall(tool.id, { status: "SUCCEEDED", result: { employees: [sneha, marcus] }, durationMs: 85, completedAt: at(85) });
  tool = await repo.startToolCall({ traceId: id, modelCallId: call, toolName: "search_employees", arguments: { query: "Sneha", password: "e2e-canary-not-a-secret" }, startedAt: at(5), providerToolCallId: "call_2" });
  await repo.finishToolCall(tool.id, { status: "REJECTED", validation: { reason: "INVALID_ARGUMENTS", detail: "unknown field" }, durationMs: 0, completedAt: at(1), errorCategory: "INVALID_ARGUMENTS" });
  await modelCall(id, { status: "SUCCEEDED", output: { text: "Sneha Singh (ACME00042) earns INR 25,00,000.00." }, decisions: [], inputTokens: 1400, outputTokens: 60, reasoningTokens: 32, latencyMs: 900 });
  await repo.finishTrace(id, { status: "COMPLETED", finalResponse: answer("Sneha Singh (ACME00042) earns INR 25,00,000.00 annual base salary."), durationMs: 2400, completedAt: at(50) });

  // 3. A tool fails while running; the model then explains.
  id = await trace("toolFailed", "Show recent changes.");
  call = await modelCall(id, { status: "SUCCEEDED", output: null, decisions: [{ name: "get_recent_compensation_changes", id: "call_3" }], inputTokens: 500, outputTokens: 20, latencyMs: 700 });
  tool = await repo.startToolCall({ traceId: id, modelCallId: call, toolName: "get_recent_compensation_changes", arguments: { days: 90 }, startedAt: at(5), providerToolCallId: "call_3" });
  await repo.finishToolCall(tool.id, { status: "FAILED", durationMs: 40, completedAt: at(40), errorCategory: "TOOL_FAILED", safeError: { code: "TOOL_FAILED" } });
  await modelCall(id, { status: "SUCCEEDED", output: { text: "I could not load recent changes." }, decisions: [], inputTokens: 600, outputTokens: 15, latencyMs: 500 });
  await repo.finishTrace(id, { status: "COMPLETED", finalResponse: answer("I could not load recent changes."), durationMs: 1400, completedAt: at(30) });

  // 4. Provider timeout after a successful tool: the earlier evidence must stay visible.
  id = await trace("timeout", "Summarize base salary by department.");
  call = await modelCall(id, { status: "SUCCEEDED", output: null, decisions: [{ name: "get_compensation_summary", id: "call_4" }], inputTokens: 450, outputTokens: 18, latencyMs: 600 });
  tool = await repo.startToolCall({ traceId: id, modelCallId: call, toolName: "get_compensation_summary", arguments: { groupBy: "DEPARTMENT" }, startedAt: at(5), providerToolCallId: "call_4" });
  await repo.finishToolCall(tool.id, { status: "SUCCEEDED", result: { groups: [{ group: "Tech", total: { amount: "3000000000.00", currency: "INR" } }] }, durationMs: 60, completedAt: at(60) });
  await modelCall(id, { status: "FAILED", latencyMs: 30000, failureCategory: "timeout", safeError: { code: "MODEL_TIMEOUT" } });
  await repo.finishTrace(id, { status: "FAILED", durationMs: 31000, completedAt: at(10), failureStage: "MODEL_CALL", errorCategory: "timeout" });

  // 5. The tool's outcome could not be recorded: the attempt stays without an outcome.
  id = await trace("persistence", "List employees named Arjun.");
  call = await modelCall(id, { status: "SUCCEEDED", output: null, decisions: [{ name: "search_employees", id: "call_5" }], inputTokens: 300, outputTokens: 10, latencyMs: 400 });
  await repo.startToolCall({ traceId: id, modelCallId: call, toolName: "search_employees", arguments: { query: "Arjun" }, startedAt: at(5), providerToolCallId: "call_5" });
  await repo.finishTrace(id, { status: "FAILED", durationMs: 600, completedAt: at(100), failureStage: "TOOL_TRACE_WRITE", errorCategory: "persistence_unavailable" });

  // 6. A large, nested tool result (about 200 KB).
  id = await trace("large", "List every Tech employee.");
  call = await modelCall(id, { status: "SUCCEEDED", output: null, decisions: [{ name: "search_employees", id: "call_6" }], inputTokens: 800, outputTokens: 20, latencyMs: 500 });
  tool = await repo.startToolCall({ traceId: id, modelCallId: call, toolName: "search_employees", arguments: { department: "Tech" }, startedAt: at(5), providerToolCallId: "call_6" });
  const employees = Array.from({ length: 900 }, (_, i) => ({
    employeeCode: `ACME${String(10000 + i).padStart(5, "0")}`,
    name: `Synthetic Person ${i}`,
    department: "Tech",
    history: [{ version: 1, annualBaseSalary: { amount: "1000000.00", currency: "INR" }, note: "x".repeat(40) }],
  }));
  await repo.finishToolCall(tool.id, { status: "SUCCEEDED", result: { employees }, durationMs: 300, completedAt: at(300) });
  await modelCall(id, { status: "SUCCEEDED", output: { text: "There are 900 matching employees." }, decisions: [], inputTokens: 3000, outputTokens: 30, latencyMs: 700 });
  await repo.finishTrace(id, { status: "COMPLETED", finalResponse: answer("There are 900 matching employees."), durationMs: 1700, completedAt: at(20) });

  process.stdout.write(`${JSON.stringify({ conversationId: conversation.id, traces })}\n`);
}

try {
  await main();
} catch (error) {
  console.error(`seed failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
