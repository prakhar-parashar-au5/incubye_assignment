// Makes three real MCP tool calls against a running backend, so the Admin MCP
// page has recorded rows (AI Task 06): one successful lookup, one call with
// invalid arguments (recorded REJECTED, INVALID_ARGUMENTS), and one call to an
// unknown tool (recorded REJECTED, UNKNOWN_TOOL). It signs in through the
// normal login API and uses the official MCP SDK client with that Bearer
// token. Operator tooling only: the server never imports src/evaluation/.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export class DemoMcpRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoMcpRefusedError';
  }
}

/** Only loopback over HTTP, or any host over HTTPS. Returns the normalised origin and path prefix. */
export function checkedApiBaseUrl(value: unknown): URL {
  if (typeof value !== 'string' || value === '') throw new DemoMcpRefusedError('API_BASE_URL is not set');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DemoMcpRefusedError('API_BASE_URL is not a valid URL');
  }
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (!loopback && url.protocol !== 'https:') throw new DemoMcpRefusedError('refusing: API_BASE_URL must be https://… or http://127.0.0.1… / http://localhost…');
  if (url.username !== '' || url.password !== '') throw new DemoMcpRefusedError('refusing: API_BASE_URL must not contain credentials');
  return url;
}

const join = (base: URL, path: string): URL => new URL(`${base.pathname.replace(/\/$/, '')}${path}`, base);

export interface DemoMcpCall { tool: string; outcome: 'ok' | 'error'; expectedRecordedStatus: 'SUCCEEDED' | 'REJECTED' }

export const DEMO_MCP_CALLS: readonly { tool: string; arguments: Record<string, unknown>; expectedRecordedStatus: DemoMcpCall['expectedRecordedStatus'] }[] = Object.freeze([
  { tool: 'search_employees', arguments: { query: 'ACME00001', limit: 1 }, expectedRecordedStatus: 'SUCCEEDED' },
  { tool: 'get_employee_compensation', arguments: { employeeCode: 'not-an-employee-code' }, expectedRecordedStatus: 'REJECTED' },
  { tool: 'delete_employee', arguments: { employeeCode: 'ACME00001' }, expectedRecordedStatus: 'REJECTED' },
]);

export async function runDemoMcpCalls({ apiBaseUrl, email, password }: { apiBaseUrl: unknown; email: unknown; password: unknown }): Promise<DemoMcpCall[]> {
  const base = checkedApiBaseUrl(apiBaseUrl);
  if (typeof email !== 'string' || email === '' || typeof password !== 'string' || password === '') throw new DemoMcpRefusedError('DEMO_EMAIL and DEMO_PASSWORD must be set');
  const login = await fetch(join(base, '/api/v1/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new DemoMcpRefusedError(`sign-in failed with HTTP ${login.status}`);
  const token: unknown = Reflect.get(await login.json() as object, 'token');
  if (typeof token !== 'string') throw new DemoMcpRefusedError('sign-in returned no token');

  const client = new Client({ name: 'acme-demo-mcp-calls', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(join(base, '/api/v1/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const results: DemoMcpCall[] = [];
  try {
    for (const call of DEMO_MCP_CALLS) {
      // An unknown tool is answered with a protocol error; either way the server has recorded the call first.
      const outcome = await client.callTool({ name: call.tool, arguments: call.arguments })
        .then((r) => (r.isError === true ? 'error' as const : 'ok' as const), () => 'error' as const);
      results.push({ tool: call.tool, outcome, expectedRecordedStatus: call.expectedRecordedStatus });
    }
  } finally {
    await client.close();
    await fetch(join(base, '/api/v1/auth/logout'), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  return results;
}
