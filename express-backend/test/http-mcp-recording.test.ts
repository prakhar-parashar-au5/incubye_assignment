// MCP call recording (AI Task 04) with a real MCP SDK client, the shared tool
// registry over fake data, and the in-memory MCP store with fault injection.
// Real MySQL rows: test/db/assistant-tools.test.ts ("MCP calls are recorded").
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { TOOL_INPUT_SCHEMAS, TOOL_NAMES, strictFunctionParameters } from '../src/assistant/tool-schemas.js';
import { createToolRegistry } from '../src/assistant/tools.js';
import type { ToolRegistry } from '../src/assistant/tools.js';
import { MCP_RECORDING_UNAVAILABLE } from '../src/http/mcp-routes.js';
import type { LogEntry } from '../src/http/request-log.js';
import { FAKE_TOKEN, MEERA, buildTestApp, fakeDirectory, fakeInsights, fakeMcpStore } from './support/http.js';

const MCP = '/api/v1/mcp';
const servers: Server[] = [];
after(async () => { await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))); });

/** The real registry over fake data; `executions` counts calls that reached the directory (real execution). */
function harness() {
  const directory = fakeDirectory();
  const executions: string[] = [];
  const counted = { ...directory, async list(...args: Parameters<typeof directory.list>) { executions.push('list'); return directory.list(...args); } };
  const registry = createToolRegistry({ directory: counted, insights: fakeInsights(), exchangeRate: null });
  const order: string[] = [];
  const mcp = fakeMcpStore();
  const tools: ToolRegistry = { definitions: registry.definitions, async run(name, args, context) { order.push(`run:${name}`); return registry.run(name, args, context); } };
  const logs: LogEntry[] = [];
  const { app } = buildTestApp({ tools, mcpStore: mcp.store, logger: (e) => logs.push(e) });
  return { app, mcp, executions, order, logs };
}

async function connect(app: ReturnType<typeof buildTestApp>['app']): Promise<Client> {
  const server = app.listen(0);
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const client = new Client({ name: 'acme-recording-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${MCP}`), { requestInit: { headers: { Authorization: `Bearer ${FAKE_TOKEN}` } } }));
  return client;
}

describe('MCP call recording', () => {
  // Detects: a tool run with no prior attempt row, or a result returned before its outcome is saved.
  test('a valid call records the attempt before execution and SUCCEEDED with the complete result before returning', async () => {
    const h = harness();
    const client = await connect(h.app);
    try {
      const result = await client.callTool({ name: 'search_employees', arguments: { query: 'nobody' } });
      assert.equal(result.isError ?? false, false);
      assert.deepEqual(h.mcp.events, ['start:search_employees', 'finish:SUCCEEDED']);
      const [call] = h.mcp.calls;
      assert.deepEqual([call?.actorId, call?.toolName, call?.arguments, call?.status], [MEERA.hrUserId, 'search_employees', { query: 'nobody' }, 'SUCCEEDED']);
      assert.deepEqual((call?.outcome as { result: unknown }).result, { data: { totalMatching: 0, returned: 0, employees: [] }, cards: [{ type: 'notice', level: 'info', message: 'No permitted employee matches that search.' }], limitations: [] });
      assert.equal(h.executions.length, 1);
    } finally { await client.close(); }
  });

  // Detects: invalid MCP input executing, or the rejection going unrecorded.
  test('invalid input is recorded REJECTED with its arguments and no result, and never executes', async () => {
    const h = harness();
    const client = await connect(h.app);
    try {
      for (const args of [{ query: '' }, { query: 'x', hrUserId: 99, password: 'p@ss' }, { limit: 'many' }]) {
        const result = await client.callTool({ name: 'search_employees', arguments: args });
        assert.equal(result.isError, true, JSON.stringify(args));
      }
      assert.deepEqual(h.mcp.calls.map((c) => [c.status, (c.outcome as { validation?: unknown }).validation, Object.hasOwn(c.outcome as object, 'result')]), [
        ['REJECTED', { reason: 'INVALID_ARGUMENTS' }, false], ['REJECTED', { reason: 'INVALID_ARGUMENTS' }, false], ['REJECTED', { reason: 'INVALID_ARGUMENTS' }, false],
      ]);
      assert.deepEqual(h.mcp.calls[1]?.arguments, { query: 'x', hrUserId: 99, password: 'p@ss' }, 'the store receives arguments as sent; the repository scrubs secret keys');
      assert.equal(h.executions.length, 0, 'no rejected call reached the directory');
    } finally { await client.close(); }
  });

  test('a call to an unknown tool is recorded REJECTED UNKNOWN_TOOL and never executes', async () => {
    const h = harness();
    const client = await connect(h.app);
    try {
      const result = await client.callTool({ name: 'run_sql', arguments: { sql: 'DELETE FROM employees' } }).catch((error: unknown) => ({ isError: true, error }));
      assert.equal(result.isError, true);
      assert.deepEqual(h.mcp.calls.map((c) => [c.toolName, c.status, (c.outcome as { validation: unknown }).validation]), [['run_sql', 'REJECTED', { reason: 'UNKNOWN_TOOL' }]]);
      assert.deepEqual(h.order, []);
    } finally { await client.close(); }
  });

  // Detects: an unrecorded MCP tool execution, or an answer whose outcome was not saved.
  test('attempt-write failure: the tool never runs; outcome-write failure: no result is returned', async () => {
    for (const stage of ['start', 'finish'] as const) {
      const h = harness();
      h.mcp.failOn(stage);
      const client = await connect(h.app);
      try {
        const result = await client.callTool({ name: 'search_employees', arguments: { query: 'nobody' } });
        assert.equal(result.isError, true, stage);
        assert.deepEqual(result.content, [{ type: 'text', text: MCP_RECORDING_UNAVAILABLE }], stage);
        assert.equal(result.structuredContent, undefined, stage);
        assert.deepEqual(h.order, stage === 'start' ? [] : ['run:search_employees'], stage);
        const failure = h.logs.find((l) => l.event === 'mcp_recording_failure');
        assert.deepEqual(failure && Object.keys(failure).sort(), ['event', 'requestId', 'stage', 'tool'], stage);
      } finally { await client.close(); }
    }
  });

  test('listing still publishes each tool\'s exact JSON Schema (validation is deferred, not removed)', async () => {
    const h = harness();
    const client = await connect(h.app);
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name), [...TOOL_NAMES]);
      for (const tool of tools) {
        const expected = strictFunctionParameters(TOOL_INPUT_SCHEMAS[tool.name as (typeof TOOL_NAMES)[number]]);
        assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), Object.keys(expected.properties ?? {}).sort(), tool.name);
        assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      }
      assert.deepEqual(h.mcp.calls, [], 'listing is not a tool call');
    } finally { await client.close(); }
  });
});
