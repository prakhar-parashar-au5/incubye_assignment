import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_LENGTH, generateTemporaryPassword, hashPassword, verifyPassword } from '../src/access/passwords.js';
import { thrown } from './support/thrown.js';

// Synthetic test value, not a real credential.
const PASSWORD = 'synthetic-test-password-1';

describe('hashPassword', () => {
  // Detects: plain-text storage, or a reversible encoding of the password.
  test('returns an Argon2id hash, not the submitted password', async () => {
    const hash = await hashPassword(PASSWORD);
    assert.ok(!hash.includes(PASSWORD));
    assert.match(hash, /^\$argon2id\$/);
  });

  // Detects: parameters below the OWASP Argon2id minimum (19 MiB, t=2, p=1).
  test('uses the documented Argon2id parameters', async () => {
    const hash = await hashPassword(PASSWORD);
    assert.equal(hash.split('$').slice(0, 4).join('$'), '$argon2id$v=19$m=19456,t=2,p=1');
  });

  // Detects: a fixed or missing salt (equal passwords would share hashes).
  test('two hashes of the same password use different salts', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    assert.notEqual(a, b);
    assert.notEqual(a.split('$')[4], b.split('$')[4]);
  });

  // Detects: empty passwords, and unbounded input that could tie up the CPU.
  test('rejects an empty, non-string, or over-long password without echoing it', async () => {
    for (const bad of ['', 42, null, 'x'.repeat(1025)]) {
      await assert.rejects(hashPassword(bad), (error: unknown) => {
        assert.match(thrown(error).message, /password/);
        assert.ok(!thrown(error).message.includes('xxxx'));
        return true;
      });
    }
  });
});

describe('verifyPassword', () => {
  test('the correct password verifies', async () => {
    assert.equal(await verifyPassword(await hashPassword(PASSWORD), PASSWORD), true);
  });

  // Detects: a verifier that ignores the password, or matches a prefix.
  test('an incorrect password fails', async () => {
    const hash = await hashPassword(PASSWORD);
    for (const wrong of ['synthetic-test-password-2', 'synthetic-test-password', `${PASSWORD} `, '']) {
      assert.equal(await verifyPassword(hash, wrong), false, 'wrong password verified');
    }
  });

  // Detects: a malformed stored hash crashing sign-in or verifying as true.
  test('a malformed stored hash fails without exposing the password', async () => {
    assert.equal(await verifyPassword('not-a-hash', PASSWORD), false);
    assert.equal(await verifyPassword(null, PASSWORD), false);
  });
});

describe('generateTemporaryPassword', () => {
  // Detects: short, fixed, or low-variety temporary passwords.
  test('is at least 12 characters from the approved alphabet, and never repeats', () => {
    const samples = Array.from({ length: 2000 }, () => generateTemporaryPassword());
    for (const password of samples) {
      assert.equal(password.length, TEMPORARY_PASSWORD_LENGTH);
      assert.ok(password.length >= 12);
      assert.ok([...password].every((c) => TEMPORARY_PASSWORD_ALPHABET.includes(c)), password);
    }
    assert.equal(new Set(samples).size, samples.length);
    // 40,000 symbols drawn uniformly from 56: every symbol appears, and none
    // is wildly over- or under-represented (expected about 714 each).
    const counts = new Map<string, number>();
    for (const c of samples.join('')) counts.set(c, (counts.get(c) ?? 0) + 1);
    assert.equal(counts.size, TEMPORARY_PASSWORD_ALPHABET.length);
    for (const n of counts.values()) assert.ok(n > 500 && n < 950, String(n));
    assert.doesNotMatch(TEMPORARY_PASSWORD_ALPHABET, /[0O1lI]/);
  });
});
