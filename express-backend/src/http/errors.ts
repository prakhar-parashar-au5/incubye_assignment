import type { ErrorRequestHandler, RequestHandler, Response } from 'express';

import { errorCode } from '../errors.js';
import { PUBLIC_MESSAGES } from './contract.js';
import type { ErrorReason, PublicErrorCode } from './contract.js';
import type { Logger } from './request-log.js';

/** A failure with a known public code. Handlers throw it; the error handler renders it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: PublicErrorCode;
  readonly reason: ErrorReason | undefined;

  constructor(status: number, code: PublicErrorCode, message: string = PUBLIC_MESSAGES[code], reason?: ErrorReason) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

/** The public error body. `reason` is included only when set. */
export function sendError(res: Response, status: number, code: PublicErrorCode, message: string = PUBLIC_MESSAGES[code], reason?: ErrorReason): void {
  res.status(status).json({ error: reason === undefined ? { code, message } : { code, message, reason } });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, 'NOT_FOUND');
};

/** body-parser marks its errors with a `type` such as 'entity.parse.failed'. */
function bodyParserType(error: unknown): string | undefined {
  const type: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'type') : undefined;
  return typeof type === 'string' ? type : undefined;
}

/**
 * Maps every error to the public shape. Unknown errors become INTERNAL_ERROR;
 * only their class name and code are logged, never the message (mysql2
 * messages can contain SQL values) or a stack trace.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      if (error.status === 401) res.set('WWW-Authenticate', 'Bearer');
      sendError(res, error.status, error.code, error.message, error.reason);
      return;
    }
    const type = bodyParserType(error);
    if (type === 'entity.too.large') {
      sendError(res, 413, 'VALIDATION_ERROR', 'Request body is too large.');
      return;
    }
    if (type !== undefined && type.startsWith('entity.') || type === 'encoding.unsupported' || type === 'charset.unsupported') {
      sendError(res, 400, 'VALIDATION_ERROR');
      return;
    }
    logger({
      event: 'request_error',
      requestId: String(res.locals.requestId ?? ''),
      method: req.method,
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode: errorCode(error) ?? null,
    });
    sendError(res, 500, 'INTERNAL_ERROR');
  };
}
