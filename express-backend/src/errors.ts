// Narrowing helpers for caught values. With useUnknownInCatchVariables a
// caught value is `unknown`: it may not be an Error at all.

/** The `code` property of a thrown value (mysql2, Node fs, or our errors), if it is a string. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/** A message for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
