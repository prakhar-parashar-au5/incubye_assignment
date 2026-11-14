// Password hashing with Argon2id (npm "argon2", maintained, MIT, prebuilt
// binaries for linux-x64/arm64 glibc and musl, so no compiler on Railway).
// Parameters: OWASP Password Storage Cheat Sheet minimum for Argon2id.
// The salt is random per hash and stored inside the PHC string.
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

function assertPassword(password) {
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new TypeError(`password must be a non-empty string of at most ${MAX_PASSWORD_LENGTH} characters`);
  }
}

/** Returns an Argon2id PHC string, e.g. $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>. */
export async function hashPassword(password) {
  assertPassword(password);
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Uses the library's verification (constant-time comparison). Returns false,
 * never throws, for a wrong password or a malformed stored hash.
 */
export async function verifyPassword(storedHash, password) {
  if (typeof storedHash !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}
