// Authenticated, read-only MCP endpoint (official MCP TypeScript SDK v2,
// Streamable HTTP, stateless: a fresh McpServer per request).
//
// Order of checks on every request:
//   1. Reject any request with an Origin header (browsers): the endpoint is
//      for non-browser MCP clients. This also blocks DNS-rebinding pages.
//   2. requireAuth: the same Bearer JWT and per-request database session,
//      HR status, and scope check as every other protected route.
//   3. The SDK handler. Tools call the shared ToolRegistry, never MySQL.
import express, { Router } from 'express';
import type { RequestHandler } from 'express';
import { originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server';

import type { Principal } from '../access/sessions.js';
import type { AuthService } from '../access/sessions.js';
import { TOOL_INPUT_SCHEMAS } from '../assistant/tool-schemas.js';
import type { ToolOutcome, ToolRegistry } from '../assistant/tools.js';
import { isoDate } from '../directory/directory-repository.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import { PATHS } from './contract.js';
import type { Logger } from './request-log.js';

export const MCP_SERVER_NAME = 'acme-compensation';
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

export function buildMcpServer({ tools, caller, logger, clock }: {
  tools: ToolRegistry;
  caller: McpCaller;
  logger: Logger;
  clock: () => Date;
}): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '1.0.0' });
  for (const definition of tools.definitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: TOOL_INPUT_SCHEMAS[definition.name],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args: unknown) => {
        const started = performance.now();
        const now = clock();
        const outcome = await tools.run(definition.name, args, { principal: caller.principal, asOf: isoDate(now), now });
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

export function mcpRoutes({ auth, tools, logger, clock = () => new Date() }: {
  auth: AuthService;
  tools: ToolRegistry;
  logger: Logger;
  clock?: () => Date;
}): Router {
  const handler = createMcpHandler(({ authInfo }) => buildMcpServer({ tools, caller: callerFrom(authInfo), logger, clock }), {
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
    const authInfo: AuthInfo = {
      // The JWT was verified by requireAuth; it is not passed further.
      token: 'verified-by-requireAuth',
      clientId: `hr-user-${principal.hrUserId}`,
      scopes: [],
      extra: { caller: new McpCaller(principal, String(res.locals.requestId ?? '')) },
    };
    await node(Object.assign(req, { auth: authInfo }), res, req.body);
  });
  return router;
}
