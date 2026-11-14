// Failed-login rate limit: 5 failed attempts per caller and account per
// 15 minutes. express-rate-limit counts each attempt and, with
// skipSuccessfulRequests, removes successful ones, so only failures use the
// allowance.
import { createHmac, randomBytes } from 'node:crypto';
import type { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';

import { normalizeEmail } from '../access/hr-users.js';
import { sendError } from './errors.js';

export const FAILED_LOGIN_LIMIT = 5;
export const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Where the client IP comes from:
 * - 'socket': the TCP peer address. Forwarded headers are ignored. The default.
 * - 'railway-x-real-ip': Railway's edge sets X-Real-IP to the client address
 *   and overwrites client copies (docs.railway.com, networking specs). Use
 *   only when the service is reached solely through Railway's public edge.
 * Express 'trust proxy' stays off: Railway documents no fixed hop count.
 */
export const CLIENT_IP_SOURCES = Object.freeze(['socket', 'railway-x-real-ip'] as const);
export type ClientIpSource = (typeof CLIENT_IP_SOURCES)[number];

// Requests whose client address cannot be determined share one bucket, so a
// missing or malformed header cannot buy a fresh allowance.
const UNKNOWN_CLIENT = 'unknown-client';
// Missing or non-string emails share one bucket per caller (bounded state).
const NO_EMAIL = 'none';

export function clientKey(req: Request, source: ClientIpSource): string {
  const raw = source === 'railway-x-real-ip' ? req.get('x-real-ip')?.trim() : req.socket.remoteAddress;
  if (raw === undefined || isIP(raw) === 0) return UNKNOWN_CLIENT;
  // IPv6 clients are grouped by /56, the library default, so one host cannot rotate addresses.
  return ipKeyGenerator(raw);
}

/**
 * The email part of the limiter key: HMAC-SHA256 of the email normalized
 * exactly as sign-in does (trim, lowercase). The HMAC key is random per
 * process, so limiter memory holds no plain email and no hash that can be
 * checked against a list of known addresses.
 */
export function emailKeyPart(body: unknown, hmacKey: Buffer): string {
  const email: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'email') : undefined;
  if (typeof email !== 'string') return NO_EMAIL;
  return createHmac('sha256', hmacKey).update(normalizeEmail(email)).digest('hex');
}

/** Rate-limit key: `ip:<client key>|email:<64 hex chars or "none">`. */
export function loginLimitKey(req: Request, source: ClientIpSource, hmacKey: Buffer): string {
  return `ip:${clientKey(req, source)}|email:${emailKeyPart(req.body, hmacKey)}`;
}

interface Bucket {
  hits: number;
  resetTime: Date;
}

/**
 * In-memory fixed-window store with an injected clock, so tests can move time
 * forward instead of waiting 15 minutes. Single process only (localKeys).
 * The clock must follow real time: express-rate-limit skips a decrement when
 * Date.now() is past the reset time this store returns.
 */
export class ClockedMemoryStore implements Store {
  readonly localKeys = true;
  private windowMs = FAILED_LOGIN_WINDOW_MS;
  private readonly buckets = new Map<string, Bucket>();
  private readonly clock: () => Date;

  constructor(clock: () => Date) {
    this.clock = clock;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private current(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetTime.getTime() <= this.clock().getTime()) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  get(key: string): ClientRateLimitInfo | undefined {
    const bucket = this.current(key);
    return bucket && { totalHits: bucket.hits, resetTime: bucket.resetTime };
  }

  /** Keys of live buckets, for tests and diagnostics. Keys never contain plain emails. */
  keys(): string[] {
    return [...this.buckets.keys()].filter((key) => this.current(key) !== undefined);
  }

  increment(key: string): ClientRateLimitInfo {
    const bucket = this.current(key) ?? { hits: 0, resetTime: new Date(this.clock().getTime() + this.windowMs) };
    bucket.hits += 1;
    this.buckets.set(key, bucket);
    return { totalHits: bucket.hits, resetTime: bucket.resetTime };
  }

  decrement(key: string): void {
    const bucket = this.current(key);
    if (bucket) bucket.hits = Math.max(0, bucket.hits - 1);
  }

  resetKey(key: string): void {
    this.buckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
  }
}

export function failedLoginLimiter({ clientIpSource, clock, store = new ClockedMemoryStore(clock) }: {
  clientIpSource: ClientIpSource;
  clock: () => Date;
  store?: ClockedMemoryStore | undefined;
}): RequestHandler {
  const hmacKey = randomBytes(32);
  return rateLimit({
    windowMs: FAILED_LOGIN_WINDOW_MS,
    limit: FAILED_LOGIN_LIMIT,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store,
    // Caller AND account (review fix 06a): through the Next.js server all
    // users share one caller address, so a caller-only key would let a few
    // failures block every user.
    keyGenerator: (req) => loginLimitKey(req, clientIpSource, hmacKey),
    handler: (_req, res) => {
      sendError(res, 429, 'RATE_LIMITED');
    },
    // Our keyGenerator never reads req.ip and trust proxy is off, so the
    // library's proxy checks do not apply; keep its other checks on.
    validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
  });
}
