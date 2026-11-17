// Contract-shaped Admin AI-monitoring responses for tests. tests/unit/ai-monitoring.test.ts checks
// each against the validators compiled from the generated contract.

export const TRACE_ID = "7548c0db-598f-45ea-8200-f1a5effb9008";
export const MCP_ID = "e6d1d691-e180-414f-966e-939cfa57d516";
const meera = { id: 1, displayName: "Meera Iyer" };

export function modelCall(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    sequence,
    status: "SUCCEEDED",
    provider: "scripted",
    model: "e2e-scripted-model",
    providerRequestId: null,
    promptVersion: "assistant-instructions-v1",
    promptHash: "a".repeat(64),
    input: [{ role: "user", content: "…" }],
    tools: [{ name: "search_employees" }],
    output: null,
    toolDecisions: [],
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    reasoningTokens: 5,
    startedAt: "2026-11-17T07:00:00.000Z",
    completedAt: "2026-11-17T07:00:01.000Z",
    latencyMs: 1000,
    failureCategory: null,
    safeError: null,
    ...overrides,
  };
}

export function toolCall(sequence: number, modelCallSequence: number, overrides: Record<string, unknown> = {}) {
  return {
    sequence,
    modelCallSequence,
    providerToolCallId: `call_${sequence}`,
    toolName: "search_employees",
    requestedArguments: { query: "Sneha" },
    validationStatus: "VALID",
    validationErrors: null,
    status: "SUCCEEDED",
    result: { employees: [{ name: "Employee 1", employeeCode: "EMPLOYEE-1", annualBaseSalary: { amount: "2500000.00", currency: "INR" } }] },
    errorCategory: null,
    safeError: null,
    startedAt: "2026-11-17T07:00:01.000Z",
    completedAt: "2026-11-17T07:00:01.100Z",
    durationMs: 100,
    ...overrides,
  };
}

export function traceDetail(overrides: Record<string, unknown> = {}, trace: Record<string, unknown> = {}) {
  return {
    view: "formatted",
    warning: null,
    redaction: { identities: "PLACEHOLDERS", note: "Employee names, codes, and emails are replaced with placeholders in this view. Salary values are shown." },
    trace: {
      traceId: TRACE_ID,
      conversationId: "5f830d20-888e-4351-b8b4-e6a03763af83",
      turnSequence: 2,
      previousTraceId: null,
      nextTraceId: null,
      requestId: "2f1436ba-ed57-4c7f-97f8-27e2ebd11302",
      hrUser: meera,
      status: "COMPLETED",
      failureStage: null,
      errorCategory: null,
      model: "e2e-scripted-model",
      promptVersion: "assistant-instructions-v1",
      promptHash: "a".repeat(64),
      startedAt: "2026-11-17T07:00:00.000Z",
      completedAt: "2026-11-17T07:00:03.000Z",
      durationMs: 3000,
      inputTokens: 200,
      outputTokens: 20,
      reasoningTokens: 10,
      modelCallCount: 2,
      toolCallCount: 2,
      ...trace,
    },
    userContent: { text: "Who are the top earners in Tech?", retryOfTraceId: null },
    modelMessages: [{ role: "user", content: "Who are the top earners in Tech?" }],
    modelCalls: [modelCall(1, { toolDecisions: [{ id: "call_1", name: "search_employees" }] }), modelCall(2, { output: { text: "Employee 1 earns INR 25,00,000.00." } })],
    toolCalls: [
      toolCall(1, 1),
      toolCall(2, 1, {
        requestedArguments: { query: "x", password: "[REDACTED]" },
        validationStatus: "REJECTED",
        validationErrors: { reason: "INVALID_ARGUMENTS" },
        status: "REJECTED",
        result: null,
        errorCategory: "INVALID_ARGUMENTS",
      }),
    ],
    finalResponse: { answer: "Employee 1 (EMPLOYEE-1) earns INR 25,00,000.00.", toolCalls: [], cards: [], limitations: [], generatedAt: "2026-11-17T07:00:03.000Z" },
    messages: [
      { sequence: 3, role: "USER", createdAt: "2026-11-17T07:00:00.000Z" },
      { sequence: 4, role: "ASSISTANT", createdAt: "2026-11-17T07:00:03.000Z" },
    ],
    review: null,
    ...overrides,
  };
}

export function review(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "PARTIAL",
    note: "Rejected search was fine.",
    nominated: true,
    version: 1,
    reviewer: meera,
    createdAt: "2026-11-17T08:00:00.000Z",
    updatedAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

export function summary(overrides: Record<string, unknown> = {}) {
  return {
    window: "24h",
    from: "2026-11-16T08:31:00.000Z",
    to: "2026-11-17T08:31:00.000Z",
    generatedAt: "2026-11-17T08:31:00.000Z",
    traces: { total: 5, completed: 3, failed: 2, started: 0 },
    failures: [{ failureStage: "MODEL_CALL", errorCategory: "timeout", count: 1 }, { failureStage: "TOOL_TRACE_WRITE", errorCategory: "persistence_unavailable", count: 1 }],
    durationMs: { completedCount: 3, p50: 1400, p95: 2400, max: 2400 },
    tokens: { input: 1000, output: 100, reasoning: 20, total: 1100 },
    modelCalls: { total: 6, byModel: [{ model: "e2e-scripted-model", count: 6 }] },
    toolCalls: [
      { toolName: "search_employees", status: "SUCCEEDED", count: 2 },
      { toolName: "search_employees", status: "REJECTED", count: 1 },
      { toolName: "get_compensation_summary", status: "FAILED", count: 1 },
    ],
    mcpCalls: [{ toolName: "search_employees", status: "SUCCEEDED", count: 1 }],
    reviews: { byVerdict: [{ verdict: "CORRECT", count: 1 }], unreviewed: 4 },
    series: { bucket: "HOUR", points: [{ start: "2026-11-17T07:00:00.000Z", traces: 5, failures: 2 }] },
    ...overrides,
  };
}

export function mcpDetail(overrides: Record<string, unknown> = {}) {
  return {
    view: "formatted",
    warning: null,
    redaction: { identities: "PLACEHOLDERS", note: "Employee names, codes, and emails are replaced with placeholders in this view. Salary values are shown." },
    call: {
      mcpCallId: MCP_ID,
      requestId: "ea02311b-4c5b-49de-989c-6086c4c712fd",
      hrUser: meera,
      toolName: "search_employees",
      validationStatus: "VALID",
      status: "SUCCEEDED",
      startedAt: "2026-11-17T08:37:04.421Z",
      completedAt: "2026-11-17T08:37:04.500Z",
      durationMs: 79,
      errorCategory: null,
      requestedArguments: { query: "Sneha" },
      validationErrors: null,
      result: { employees: [{ name: "Employee 1", employeeCode: "EMPLOYEE-1" }] },
      safeError: null,
    },
    ...overrides,
  };
}
