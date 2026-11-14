// Assertion helpers read thrown values, which are `unknown` under strict mode.

export interface ThrownFields {
  code: unknown;
  reason: unknown;
  migration: unknown;
  message: string;
  details: readonly string[];
}

/** The fields tests inspect on a thrown value, without assuming its class. */
export function thrown(error: unknown): ThrownFields {
  const target: object = Object(error);
  const details: unknown = Reflect.get(target, 'details');
  return {
    code: Reflect.get(target, 'code'),
    reason: Reflect.get(target, 'reason'),
    migration: Reflect.get(target, 'migration'),
    message: error instanceof Error ? error.message : String(error),
    details: Array.isArray(details) ? details.map(String) : [],
  };
}
