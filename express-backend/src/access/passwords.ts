// Password hashing with Argon2id (npm "argon2", maintained, MIT, prebuilt
// binaries for linux-x64/arm64 glibc and musl, so no compiler on Railway).
// Parameters: OWASP Password Storage Cheat Sheet minimum for Argon2id.
// The salt is random per hash and stored inside the PHC string.
import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456, // KiB (19 MiB)
  timeCost: 2,
  parallelism: 1,
});

// Upper bound so one request cannot make the server hash megabytes of input.
export const MAX_PASSWORD_LENGTH = 1024;
// Approved rule for every newly created HR user password (04a).
export const NEW_PASSWORD_MIN_LENGTH = 12;

// Temporary passwords for new HR users: 20 characters drawn uniformly by
// crypto.randomInt from 56 symbols without look-alikes (0/O, 1/l/I), about
// 116 bits. Generated server-side and returned once; only the hash is stored.
export const TEMPORARY_PASSWORD_LENGTH = 20;
export const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < TEMPORARY_PASSWORD_LENGTH; i += 1) password += TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  return password;
}

function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new TypeError(`password must be a non-empty string of at most ${MAX_PASSWORD_LENGTH} characters`);
  }
}

/** Returns an Argon2id PHC string, e.g. $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>. */
export async function hashPassword(password: unknown): Promise<string> {
  assertPassword(password);
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Uses the library's verification (constant-time comparison). Returns false,
 * never throws, for a wrong password or a malformed stored hash.
 */
export async function verifyPassword(storedHash: unknown, password: unknown): Promise<boolean> {
  if (typeof storedHash !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}
