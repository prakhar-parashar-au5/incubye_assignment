import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { ClockedMemoryStore } from '../src/http/rate-limit.js';
import { FAKE_PASSWORD, buildTestApp } from './support/http.js';

const LOGIN = '/api/v1/auth/login';
const wrong = { email: 'meera.iyer@acme.com', password: 'wrong-password' };
const right = { email: 'meera.iyer@acme.com', password: FAKE_PASSWORD };
const rateLimited = { error: { code: 'RATE_LIMITED', message: 'Too many failed login attempts. Try again later.' } };

// In 'railway-x-real-ip' mode the client IP comes from X-Real-IP, which lets
// these tests simulate several clients through one local socket.
function railwayApp() {
  return buildTestApp({ clientIpSource: 'railway-x-real-ip' });
}

describe('failed-login rate limit', () => {
  // Detects: a limit that is too strict (blocks the 5th attempt) or missing.
  test('allows five failed attempts, then returns 429 RATE_LIMITED', async () => {
    const { app } = railwayApp();
    for (let i = 1; i <= 5; i += 1) {
      const res = await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.10').send(wrong);
      assert.equal(res.status, 401, `attempt ${i}`);
    }
    const blocked = await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.10').send(wrong);
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, rateLimited);
  });

  // Detects: a correct password still accepted after the limit (brute force then succeeds).
  test('blocks even correct credentials once the limit is reached', async () => {
    const { app } = railwayApp();
    for (let i = 0; i < 5; i += 1) await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.11').send(wrong);
    const res = await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.11').send(right);
    assert.equal(res.status, 429);
  });

  // Detects: one global counter shared by every client.
  test('another IP has a separate limit', async () => {
    const { app } = railwayApp();
    for (let i = 0; i < 6; i += 1) await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.12').send(wrong);
    const other = await request(app).post(LOGIN).set('X-Real-IP', '198.51.100.7').send(wrong);
    assert.equal(other.status, 401);
  });

  // Detects: successful logins counted as failures (locking out a busy shared office IP).
  test('a successful login does not consume the failed-attempt allowance', async () => {
    const { app } = railwayApp();
    for (let i = 0; i < 4; i += 1) await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.13').send(wrong);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.13').send(right)).status, 200);
    }
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.13').send(wrong)).status, 401, 'fifth failure');
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.13').send(wrong)).status, 429, 'sixth failure');
  });

  // Detects: a window that never resets, or that resets early (uses the injected clock).
  test('the window resets after 15 minutes, not before', async () => {
    const { app, advance } = railwayApp();
    for (let i = 0; i < 6; i += 1) await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.14').send(wrong);
    advance(15 * 60 * 1000 - 1000);
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.14').send(wrong)).status, 429);
    advance(2000);
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.14').send(wrong)).status, 401);
  });

  // Detects: the limiter applied to other endpoints.
  test('does not limit /health or /me', async () => {
    const { app } = railwayApp();
    for (let i = 0; i < 6; i += 1) await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.15').send(wrong);
    assert.equal((await request(app).get('/health').set('X-Real-IP', '203.0.113.15')).status, 200);
  });
});

describe('client IP source', () => {
  // Detects: forwarded headers trusted outside the approved deployment mode,
  // which would let an attacker reset their limit with every request.
  test("in 'socket' mode, spoofed X-Real-IP and X-Forwarded-For values share one limit", async () => {
    const { app } = buildTestApp({ clientIpSource: 'socket' });
    for (let i = 1; i <= 5; i += 1) {
      const res = await request(app).post(LOGIN)
        .set('X-Real-IP', `192.0.2.${i}`).set('X-Forwarded-For', `192.0.2.${i}`).send(wrong);
      assert.equal(res.status, 401);
    }
    const res = await request(app).post(LOGIN).set('X-Real-IP', '192.0.2.99').set('X-Forwarded-For', '192.0.2.99').send(wrong);
    assert.equal(res.status, 429);
  });

  // Detects: X-Forwarded-For used in Railway mode (Railway documents X-Real-IP).
  test("in 'railway-x-real-ip' mode, X-Forwarded-For is ignored", async () => {
    const { app } = railwayApp();
    for (let i = 1; i <= 5; i += 1) {
      await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.20').set('X-Forwarded-For', `192.0.2.${i}`).send(wrong);
    }
    const res = await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.20').set('X-Forwarded-For', '192.0.2.200').send(wrong);
    assert.equal(res.status, 429);
  });

  // Detects: a missing or malformed X-Real-IP giving each request a fresh bucket.
  test("in 'railway-x-real-ip' mode, missing or invalid X-Real-IP values share one limit", async () => {
    const { app } = railwayApp();
    const headers = [undefined, 'not-an-ip', '', '203.0.113.30, 203.0.113.31', 'garbage'];
    for (const value of headers) {
      const call = request(app).post(LOGIN);
      const res = value === undefined ? await call.send(wrong) : await call.set('X-Real-IP', value).send(wrong);
      assert.equal(res.status, 401, String(value));
    }
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', 'other-garbage').send(wrong)).status, 429);
  });
});

// Review fix 06a: through the Next.js server every user shares one caller
// address, so the key is caller + hash(normalized email).
describe('failed-login rate limit key: caller and email', () => {
  const fail = (app: ReturnType<typeof buildTestApp>['app'], email: unknown, ip = '203.0.113.40') =>
    request(app).post(LOGIN).set('X-Real-IP', ip).send({ email, password: 'wrong-password' });

  // Detects: one bucket per caller, where 5 failures by one user block every
  // user behind the same Next.js server.
  test('a different email from the same caller has a separate allowance', async () => {
    const { app } = railwayApp();
    for (let i = 0; i < 5; i += 1) assert.equal((await fail(app, 'first.user@acme.com')).status, 401);
    assert.equal((await fail(app, 'first.user@acme.com')).status, 429);
    assert.equal((await fail(app, 'second.user@acme.com')).status, 401);
    const other = await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.40').send(right);
    assert.equal(other.status, 200, 'another account still signs in through the same caller');
  });

  // Detects: case or whitespace variants buying extra attempts for one account.
  test('email case and surrounding spaces share one allowance', async () => {
    const { app } = railwayApp();
    const variants = ['case.check@acme.com', 'Case.Check@ACME.com', '  case.check@acme.com ', 'CASE.CHECK@acme.com', ' Case.check@Acme.Com'];
    for (const email of variants) await fail(app, email);
    assert.equal((await fail(app, 'case.check@acme.com')).status, 429);
  });

  // Detects: the caller part dropped from the key (one IP locking an account everywhere).
  test('the same email from a different caller IP has a separate allowance', async () => {
    const { app } = railwayApp();
    for (let i = 0; i < 6; i += 1) await fail(app, 'same.email@acme.com', '203.0.113.41');
    assert.equal((await fail(app, 'same.email@acme.com', '203.0.113.41')).status, 429);
    assert.equal((await fail(app, 'same.email@acme.com', '198.51.100.41')).status, 401);
  });

  // Detects: missing or non-string emails each getting a fresh bucket.
  test('missing and non-string emails share one bounded sentinel bucket per caller', async () => {
    const store = new ClockedMemoryStore(() => new Date());
    const { app } = buildTestApp({ clientIpSource: 'railway-x-real-ip', rateLimitStore: store });
    const odd: unknown[] = [undefined, 42, null, ['x'], { nested: true }];
    for (const email of odd) {
      const body = email === undefined ? { password: 'x' } : { email, password: 'x' };
      assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.42').send(body)).status, 400);
    }
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.42').send({ password: 'x' })).status, 429);
    assert.equal(store.keys().length, 1);
    assert.equal((await fail(app, 'real.user@acme.com', '203.0.113.42')).status, 401, 'a real email from that caller is separate');
  });

  // Detects: spoofed forwarding headers creating fresh buckets in socket mode.
  test('spoofed forwarding headers still have no effect in socket mode', async () => {
    const { app } = buildTestApp({ clientIpSource: 'socket' });
    for (let i = 1; i <= 6; i += 1) {
      await request(app).post(LOGIN).set('X-Real-IP', `192.0.2.${i}`).set('X-Forwarded-For', `192.0.2.${i}`)
        .send({ email: 'spoof.check@acme.com', password: 'wrong-password' });
    }
    const res = await request(app).post(LOGIN).set('X-Real-IP', '192.0.2.77').set('X-Forwarded-For', '192.0.2.77')
      .send({ email: 'spoof.check@acme.com', password: 'wrong-password' });
    assert.equal(res.status, 429);
  });

  // Detects: plain emails kept in limiter memory or written to logs.
  test('limiter state and logs never contain the plain email', async () => {
    const store = new ClockedMemoryStore(() => new Date());
    const { app, logs } = buildTestApp({ clientIpSource: 'railway-x-real-ip', rateLimitStore: store });
    await fail(app, 'Private.Person@acme.com');
    await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.40').send(right);
    const keys = store.keys();
    assert.ok(keys.length >= 1);
    for (const key of keys) {
      assert.match(key, /^ip:[0-9a-f:.]+\|email:[0-9a-f]{64}$/);
      assert.doesNotMatch(key, /private|person|meera|acme/i);
    }
    assert.doesNotMatch(JSON.stringify(logs), /private\.person|meera\.iyer|acme\.com/i);
  });

  // Detects: successes counted against the email bucket.
  test('a successful login does not consume that email’s allowance', async () => {
    const { app } = railwayApp();
    for (let i = 0; i < 4; i += 1) await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.43').send(wrong);
    for (let i = 0; i < 3; i += 1) assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.43').send(right)).status, 200);
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.43').send(wrong)).status, 401);
    assert.equal((await request(app).post(LOGIN).set('X-Real-IP', '203.0.113.43').send(wrong)).status, 429);
  });
});
