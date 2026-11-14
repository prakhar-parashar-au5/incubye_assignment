// Process entry point: validated configuration, one MySQL pool, the app, and
// graceful shutdown on SIGTERM/SIGINT (Railway sends SIGTERM on redeploy).
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAuthService } from './access/sessions.js';
import { createSessionTokens } from './access/session-tokens.js';
import { createPool } from './db/connection.js';
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
const app = createApp({
  auth: createAuthService({ pool, tokens }),
  logger: stdoutLogger,
  clientIpSource: config.clientIpSource,
});

const server = createServer(app);
server.listen(config.port, () => {
  const { port } = server.address() as AddressInfo; // listening on TCP, so address() is an AddressInfo
  stdoutLogger({ event: 'server_listening', port, clientIpSource: config.clientIpSource });
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
