export const REDACTED = '[REDACTED]';

export const PAYLOAD_LIMITS = Object.freeze({
  message: 16 * 1024,
  /** Final assistant response (answer, tool statuses, up to 8 cards, limitations). Task 03. */
  assistantResponse: 256 * 1024,
  modelInput: 128 * 1024,
  modelOutput: 128 * 1024,
  toolArguments: 32 * 1024,
  toolResult: 256 * 1024,
  validation: 16 * 1024,
  safeError: 8 * 1024,
});

export class PersistenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceValidationError';
  }
}

const secretKey = (key: string): boolean => {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized === 'authorization' || normalized === 'authorizationheader' ||
    normalized === 'cookie' || normalized === 'cookies' || normalized === 'setcookie' ||
    normalized.includes('password') || normalized.includes('apikey') ||
    normalized.includes('jwt') || normalized.includes('token') ||
    normalized === 'reasoning' || normalized === 'hiddenreasoning' || normalized === 'encryptedreasoning' || normalized === 'chainofthought' ||
    normalized === 'databaseurl' || normalized === 'dburl' ||
    normalized === 'databasepassword' || normalized === 'dbpassword' ||
    normalized === 'databasecredential' || normalized === 'dbcredential' ||
    normalized === 'databasecredentials' || normalized === 'dbcredentials';
};

/** JSON-only copy. This deliberately refuses class instances and cyclic graphs. */
export function scrubSecrets(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object') throw new PersistenceValidationError('unsupported JSON value');
    if (seen.has(item)) throw new PersistenceValidationError('cyclic JSON value');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new PersistenceValidationError('only plain JSON objects can be recorded');
    }
    seen.add(item);
    const result = Array.isArray(item)
      ? item.map(visit)
      : Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, secretKey(key) ? REDACTED : visit(entry)]));
    seen.delete(item);
    return result;
  };
  return visit(value);
}

export function boundedJson(value: unknown, maxBytes: number): string {
  const encoded = JSON.stringify(scrubSecrets(value));
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw new PersistenceValidationError('JSON payload exceeds its storage limit');
  }
  return encoded;
}

export type TraceStatus = 'STARTED' | 'COMPLETED' | 'FAILED';
export function validateTraceTransition(from: TraceStatus, to: TraceStatus): void {
  if (from !== 'STARTED' || (to !== 'COMPLETED' && to !== 'FAILED')) {
    throw new PersistenceValidationError('invalid trace status transition');
  }
}

export type ReviewVerdict = 'CORRECT' | 'PARTIAL' | 'INCORRECT';
export function validateReview(verdict: string, note: string): asserts verdict is ReviewVerdict {
  if (!['CORRECT', 'PARTIAL', 'INCORRECT'].includes(verdict) || note.length > 2000) {
    throw new PersistenceValidationError('invalid trace review');
  }
}
