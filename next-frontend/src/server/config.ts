import 'server-only';

// Server configuration comes only from the injected process environment. Nothing in this app
// reads `.env` files. Error messages name the variables that are wrong, never their values.

export type ServerConfig = {
  apiBaseUrl: URL;
  apiTimeoutMs: number;
  /** The assistant runs model and tool rounds (backend limit 45 s), so it has its own timeout. */
  assistantTimeoutMs: number;
};

export class ConfigurationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`invalid server configuration: ${variables.join(', ')} (missing or invalid)`);
    this.name = 'ConfigurationError';
    this.variables = variables;
  }
}

export const DEFAULT_API_TIMEOUT_MS = 5000;
export const DEFAULT_ASSISTANT_TIMEOUT_MS = 50_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const MAX_ASSISTANT_TIMEOUT_MS = 120_000;

type Env = Readonly<Record<string, string | undefined>>;

function parseBaseUrl(raw: string | undefined): URL | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  // Credentials, queries, and fragments in a base URL are configuration mistakes and could leak.
  if (url.username || url.password || url.search || url.hash) return undefined;
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

function parseTimeout(raw: string | undefined, fallback = DEFAULT_API_TIMEOUT_MS, max = MAX_TIMEOUT_MS): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= MIN_TIMEOUT_MS && value <= max ? value : undefined;
}

export function readServerConfig(env: Env = process.env): ServerConfig {
  const apiBaseUrl = parseBaseUrl(env.API_BASE_URL);
  const apiTimeoutMs = parseTimeout(env.API_TIMEOUT_MS);
  const assistantTimeoutMs = parseTimeout(env.API_ASSISTANT_TIMEOUT_MS, DEFAULT_ASSISTANT_TIMEOUT_MS, MAX_ASSISTANT_TIMEOUT_MS);
  const invalid: string[] = [];
  if (!apiBaseUrl) invalid.push('API_BASE_URL');
  if (apiTimeoutMs === undefined) invalid.push('API_TIMEOUT_MS');
  if (assistantTimeoutMs === undefined) invalid.push('API_ASSISTANT_TIMEOUT_MS');
  if (!apiBaseUrl || apiTimeoutMs === undefined || assistantTimeoutMs === undefined) throw new ConfigurationError(invalid);
  return { apiBaseUrl, apiTimeoutMs, assistantTimeoutMs };
}

// The shared demo password is public synthetic access shown on the sign-in page by design. It is
// still read on the server at request time so that each deployment injects its own value.
export function readDemoPassword(env: Env = process.env): string | undefined {
  const value = env.DEMO_SHARED_PASSWORD;
  return value && value.length >= 1 && value.length <= 1024 ? value : undefined;
}
