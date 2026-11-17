// Authenticated, read-only MCP endpoint (official MCP TypeScript SDK v2,
// Streamable HTTP, stateless: a fresh McpServer per request).
//
// Order of checks on every request:
//   1. Reject any request with an Origin header (browsers): the endpoint is
//      for non-browser MCP clients. This also blocks DNS-rebinding pages.
//   2. requireAuth: the same Bearer JWT and per-request database session,
//      HR status, and scope check as every other protected route.
//   3. The SDK handler. Tools call the shared ToolRegistry, never MySQL.
//
// Recording (AI Task 04, fail closed). Every tools/call is stored in
// mcp_tool_calls: the attempt is written before validation or execution, and
// the outcome (REJECTED, SUCCEEDED, or FAILED, classified by
// tool-outcome.ts like the assistant) before the result is returned. The
// SDK's own input validation is replaced by a pass-through schema with the
// same published JSON Schema, so invalid input reaches the recorder and is
// then rejected by the registry's Zod schema without executing. A call to an
// unknown tool is recorded REJECTED here before the SDK answers it. If a
// required write fails, the tool does not run or its result is not
// returned. No AI trace or model-call row is written for MCP.
import express, { Router } from 'express';
import type { RequestHandler } from 'express';
import { originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server';

import type { Principal } from '../access/sessions.js';
import type { AuthService } from '../access/sessions.js';
import type { createObservabilityRepository } from '../assistant/observability/repository.js';
import { recordedToolOutcome } from '../assistant/tool-outcome.js';
import { TOOL_INPUT_SCHEMAS } from '../assistant/tool-schemas.js';
import type { ToolOutcome, ToolRegistry } from '../assistant/tools.js';
import { isoDate } from '../directory/directory-repository.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import { PATHS } from './contract.js';
import { ApiError } from './errors.js';
import type { Logger } from './request-log.js';

export const MCP_SERVER_NAME = 'acme-compensation';
/** The tool error text when a required MCP recording write fails. Nothing else is disclosed. */
export const MCP_RECORDING_UNAVAILABLE = 'MCP_RECORDING_UNAVAILABLE';

/** The MCP recording port: the observability repository's MCP writes. */
export type McpCallStore = Pick<ReturnType<typeof createObservabilityRepository>, 'startMcpCall' | 'finishMcpCall'>;

const dbTime = (instant: Date): string => instant.toISOString().replace('T', ' ').replace('Z', '');
const elapsed = (started: number): number => Math.max(0, Math.round(performance.now() - started));

/**
 * The registry's Zod schema for listing (same JSON Schema), with validation
 * deferred: the SDK passes the raw arguments through, so the attempt is
 * recorded first and the registry validates them with the same schema.
 */
function recordFirstSchema<S extends { '~standard': { jsonSchema?: unknown } }>(schema: S): S {
  const standard = schema['~standard'];
  return { '~standard': { version: 1, vendor: 'acme-record-first', validate: (value: unknown) => ({ value }), jsonSchema: standard.jsonSchema } } as unknown as S;
}
export const MCP_BODY_LIMIT = '64kb';

/** The authenticated caller, carried to the per-request server through AuthInfo.extra. */
export class McpCaller {
  constructor(readonly principal: Principal, readonly requestId: string) {}
}

function callerFrom(authInfo: AuthInfo | undefined): McpCaller {
  const caller = authInfo?.extra?.caller;
  // Fail closed: the route always sets this after requireAuth.
  if (!(caller instanceof McpCaller)) throw new Error('MCP request without an authenticated caller');
  return caller;
}

function toCallToolResult(outcome: ToolOutcome): CallToolResult {
  if (outcome.status === 'completed') {
    const { data, cards, limitations } = outcome.result;
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: { data, cards, limitations },
    };
  }
  const error = outcome.status === 'rejected' ? outcome.reason : 'TOOL_FAILED';
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] };
}

export function buildMcpServer({ tools, caller, store, logger, clock }: {
  tools: ToolRegistry;
  caller: McpCaller;
  store: McpCallStore;
  logger: Logger;
  clock: () => Date;
}): McpServer {
  /** One required write; a failure stops the call with a fixed, safe error. */
  async function persist<T>(stage: 'MCP_ATTEMPT_WRITE' | 'MCP_OUTCOME_WRITE', tool: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch {
      logger({ event: 'mcp_recording_failure', requestId: caller.requestId, tool, stage });
      throw new Error(MCP_RECORDING_UNAVAILABLE);
    }
  }
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '1.0.0' });
  for (const definition of tools.definitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: recordFirstSchema(TOOL_INPUT_SCHEMAS[definition.name]),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args: unknown) => {
        const started = performance.now();
        const now = clock();
        // 1. Attempt, before validation or execution. The principal is the server's, never an argument.
        const call = await persist('MCP_ATTEMPT_WRITE', definition.name, () => store.startMcpCall({
          actorId: caller.principal.hrUserId, requestId: caller.requestId, toolName: definition.name, arguments: args ?? {}, startedAt: dbTime(now),
        }));
        // 2. The shared registry validates (REJECTED, not executed) or runs the tool.
        const outcome = await tools.run(definition.name, args, { principal: caller.principal, asOf: isoDate(now), now });
        // 3. Outcome, before anything is returned.
        await persist('MCP_OUTCOME_WRITE', definition.name, () => store.finishMcpCall(call.id, recordedToolOutcome(outcome, { durationMs: elapsed(started), completedAt: dbTime(clock()) })));
        logger({
          event: 'mcp_tool',
          requestId: caller.requestId,
          tool: definition.name,
          status: outcome.status,
          durationMs: Math.round((performance.now() - started) * 10) / 10,
        });
        return toCallToolResult(outcome);
      },
    );
  }
  return server;
}

/** tools/call names in a JSON-RPC body (one message or a batch). */
function calledToolNames(body: unknown): { name: string; args: unknown }[] {
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  return messages.flatMap((m) => {
    if (typeof m !== 'object' || m === null || Reflect.get(m, 'method') !== 'tools/call') return [];
    const params: unknown = Reflect.get(m, 'params');
    const name: unknown = typeof params === 'object' && params !== null ? Reflect.get(params, 'name') : undefined;
    const args: unknown = typeof params === 'object' && params !== null ? Reflect.get(params, 'arguments') : undefined;
    return [{ name: typeof name === 'string' ? name : String(name), args }];
  });
}

export function mcpRoutes({ auth, tools, store, logger, clock = () => new Date() }: {
  auth: AuthService;
  tools: ToolRegistry;
  store: McpCallStore;
  logger: Logger;
  clock?: () => Date;
}): Router {
  const known = new Set<string>(tools.definitions.map((d) => d.name));
  const handler = createMcpHandler(({ authInfo }) => buildMcpServer({ tools, caller: callerFrom(authInfo), store, logger, clock }), {
    // Reporting only; logs the error class, never its message.
    onerror: (error) => logger({ event: 'mcp_error', errorName: error.name }),
  });
  const node = toNodeHandler(handler, { onerror: (error) => logger({ event: 'mcp_error', errorName: error.name }) });
  const rejectBrowserOrigin = originValidation([]);
  const noBrowserOrigin: RequestHandler = (req, res, next) => {
    if (rejectBrowserOrigin(req, res)) next();
  };
  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  const router = Router();
  router.all(PATHS.mcp, noStore, noBrowserOrigin, requireAuth(auth), express.json({ limit: MCP_BODY_LIMIT, strict: true }), async (req, res) => {
    const { principal } = res.locals as AuthLocals;
    const requestId = String(res.locals.requestId ?? '');
    // A call to an unknown tool never reaches a handler: record it REJECTED here, then let the SDK answer.
    for (const { name, args } of calledToolNames(req.body)) {
      if (known.has(name)) continue;
      const startedAt = dbTime(clock());
      try {
        const call = await store.startMcpCall({ actorId: principal.hrUserId, requestId, toolName: name.slice(0, 120), arguments: args ?? {}, startedAt });
        await store.finishMcpCall(call.id, recordedToolOutcome({ status: 'rejected', reason: 'UNKNOWN_TOOL' }, { durationMs: 0, completedAt: startedAt }));
      } catch {
        logger({ event: 'mcp_recording_failure', requestId, tool: 'UNKNOWN', stage: 'MCP_ATTEMPT_WRITE' });
        throw new ApiError(503, 'SERVICE_UNAVAILABLE');
      }
    }
    const authInfo: AuthInfo = {
      // The JWT was verified by requireAuth; it is not passed further.
      token: 'verified-by-requireAuth',
      clientId: `hr-user-${principal.hrUserId}`,
      scopes: [],
      extra: { caller: new McpCaller(principal, requestId) },
    };
    await node(Object.assign(req, { auth: authInfo }), res, req.body);
  });
  return router;
}
