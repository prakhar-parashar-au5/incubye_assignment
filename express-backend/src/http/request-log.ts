// Structured request logs. Only safe fields: never bodies, query strings,
// headers, credentials, tokens, cookies, salaries, or database details.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';

export type LogValue = string | number | boolean | null;
export type LogEntry = { event: string } & Record<string, LogValue>;
export type Logger = (entry: LogEntry) => void;

/** JSON lines on stdout: what the server process uses. */
export const stdoutLogger: Logger = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

/**
 * Assigns a server-generated request ID (client-supplied IDs are not trusted)
 * and logs method, path without the query string, status, and duration.
 */
export function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.locals.requestId = requestId;
    res.set('X-Request-Id', requestId);
    res.on('finish', () => {
      logger({
        event: 'request',
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round((performance.now() - started) * 10) / 10,
      });
    });
    next();
  };
}
