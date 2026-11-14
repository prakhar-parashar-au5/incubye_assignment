// Guards for the destructive seed. Checked before any file or database work.
import { isOneOf } from '../source-workbook/constants.js';

export const SEED_APP_ENVS = Object.freeze(['development', 'test', 'demo'] as const);
export type SeedAppEnv = (typeof SEED_APP_ENVS)[number];

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

/**
 * @param appEnv  injected environment value; untrusted, so unknown
 * @throws {SeedRefusedError}
 */
export function assertSeedAllowed({ replace, appEnv }: { replace: unknown; appEnv: unknown }): void {
  if (appEnv === 'production') {
    throw new SeedRefusedError('refusing to seed: APP_ENV=production. The seed deletes all employee and compensation data');
  }
  if (!isOneOf(SEED_APP_ENVS, appEnv)) {
    throw new SeedRefusedError(`refusing to seed: APP_ENV must be one of ${SEED_APP_ENVS.join(', ')}`);
  }
  if (replace !== true) {
    throw new SeedRefusedError('refusing to seed without --replace. The seed deletes all employee and compensation data');
  }
}
