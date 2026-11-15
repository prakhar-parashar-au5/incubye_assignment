// Process entry point: validated configuration, one MySQL pool, the app, and
// graceful shutdown on SIGTERM/SIGINT (Railway sends SIGTERM on redeploy).
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAuthService } from './access/sessions.js';
import { createSessionTokens } from './access/session-tokens.js';
import { createAssistantService } from './assistant/assistant-service.js';
import { createCompensationInsights } from './assistant/compensation-insights.js';
import { createOpenAiModelAdapter } from './assistant/openai-model.js';
import { createToolRegistry } from './assistant/tools.js';
import { createPool } from './db/connection.js';
import { createDirectoryService } from './directory/directory-repository.js';
import { loadExchangeRate } from './directory/exchange-rate.js';
import type { ExchangeRateSnapshot } from './directory/exchange-rate.js';
import { errorMessage } from './errors.js';
import { createApp } from './http/app.js';
import { readServerConfig } from './http/config.js';
import { stdoutLogger } from './http/request-log.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let config;
try {
  config = readServerConfig(process.env);
} catch (error) {
  console.error(`Error: ${errorMessage(error)}`);
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
const tokens = createSessionTokens({ signingKey: config.jwtSigningKey });

// The shipped snapshot. If it cannot be read, the API still serves the
// directory; INR rows have no USD equivalent and salary sorting is rejected.
let exchangeRate: ExchangeRateSnapshot | null = null;
try {
  exchangeRate = await loadExchangeRate();
} catch (error) {
  stdoutLogger({ event: 'exchange_rate_unavailable', errorName: error instanceof Error ? error.name : typeof error });
}

const directory = createDirectoryService({ pool, exchangeRate });
const tools = createToolRegistry({ directory, insights: createCompensationInsights({ pool, exchangeRate }), exchangeRate });
// Without OPENAI_API_KEY the assistant reports unavailable; every other route works.
const model = config.openAiApiKey === null ? null : createOpenAiModelAdapter({ apiKey: config.openAiApiKey, model: config.openAiModel });

const app = createApp({
  auth: createAuthService({ pool, tokens }),
  directory,
  tools,
  assistant: createAssistantService({ model, tools, logger: stdoutLogger }),
  logger: stdoutLogger,
  clientIpSource: config.clientIpSource,
});

const server = createServer(app);
server.listen(config.port, () => {
  const { port } = server.address() as AddressInfo; // listening on TCP, so address() is an AddressInfo
  stdoutLogger({ event: 'server_listening', port, clientIpSource: config.clientIpSource, assistant: model === null ? 'unavailable' : 'configured' });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stdoutLogger({ event: 'server_stopping', signal });
  const forceExit = setTimeout(() => {
    stdoutLogger({ event: 'server_shutdown_timeout' });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
    stdoutLogger({ event: 'server_stopped' });
    await pool.end();
    stdoutLogger({ event: 'database_pool_closed' });
    process.exitCode = 0;
  } catch (error) {
    stdoutLogger({ event: 'server_shutdown_failed', errorName: error instanceof Error ? error.name : typeof error });
    process.exitCode = 1;
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
