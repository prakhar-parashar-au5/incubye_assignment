#!/usr/bin/env node
// Manual agent evaluation against the real OpenAI model. Not part of the
// automated tests. Needs OPENAI_API_KEY in the process environment (never a
// .env file) and a seeded database. Read-only.
//
// For each case in assistant-eval-cases.ts it checks that the model's first
// tool call is the expected tool (or no tool for a mutation request).
// Prints case IDs, tool names, and pass/fail only: no answers or data.
//
// Usage: DATABASE_URL=... OPENAI_API_KEY=... npm run eval:assistant
import type { Principal } from '../src/access/sessions.js';
import { createAssistantService } from '../src/assistant/assistant-service.js';
import { createCompensationInsights } from '../src/assistant/compensation-insights.js';
import { createOpenAiModelAdapter, DEFAULT_OPENAI_MODEL } from '../src/assistant/openai-model.js';
import { createToolRegistry } from '../src/assistant/tools.js';
import type { ToolRegistry } from '../src/assistant/tools.js';
import { createPool } from '../src/db/connection.js';
import { createDirectoryService } from '../src/directory/directory-repository.js';
import { loadExchangeRate } from '../src/directory/exchange-rate.js';
import { ASSISTANT_EVAL_CASES } from './assistant-eval-cases.js';

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.trim() === '') {
  console.error('OPENAI_API_KEY is not set; the live evaluation was not run.');
  process.exit(2);
}
const model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;

const ADMIN: Principal = {
  hrUserId: 0, email: 'eval@acme.com', displayName: 'Evaluation', role: 'ADMIN', status: 'ACTIVE',
  countries: [], departments: [], sessionId: 'eval', sessionExpiresAt: new Date(0),
};

const pool = createPool(process.env.DATABASE_URL, { connectionLimit: 2 });
let failures = 0;
try {
  const exchangeRate = await loadExchangeRate();
  const tools = createToolRegistry({
    directory: createDirectoryService({ pool, exchangeRate }),
    insights: createCompensationInsights({ pool, exchangeRate }),
    exchangeRate,
  });
  console.log(`model=${model} cases=${ASSISTANT_EVAL_CASES.length}`);
  for (const evalCase of ASSISTANT_EVAL_CASES) {
    const called: string[] = [];
    const recording: ToolRegistry = {
      definitions: tools.definitions,
      run(name, args, context) {
        called.push(name);
        return tools.run(name, args, context);
      },
    };
    const assistant = createAssistantService({
      model: createOpenAiModelAdapter({ apiKey, model }),
      tools: recording,
      logger: () => undefined,
    });
    let outcome: string;
    try {
      const reply = await assistant.ask(ADMIN, [{ role: 'user', content: evalCase.question }], `eval-${evalCase.id}`);
      const first = called[0] ?? null;
      const pass = first === evalCase.expectedTool && reply.toolCalls.every((t) => t.status === 'completed');
      if (!pass) failures += 1;
      outcome = `${pass ? 'PASS' : 'FAIL'} first=${first ?? 'none'} expected=${evalCase.expectedTool ?? 'none'} calls=${called.join(',') || 'none'}`;
    } catch (error) {
      failures += 1;
      outcome = `FAIL ${error instanceof Error ? error.name : 'error'}`;
    }
    console.log(`${evalCase.id}: ${outcome}`);
  }
} finally {
  await pool.end();
}
console.log(failures === 0 ? 'all cases passed' : `${failures} case(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
