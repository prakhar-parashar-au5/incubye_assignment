/**
 * Returns a value the test setup guarantees, or fails loudly. The JavaScript
 * tests relied on a TypeError when a lookup like `rows[0]` or `find()` missed;
 * this keeps that failure, with a clearer message.
 */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`test setup: expected ${what}`);
  return value;
}
