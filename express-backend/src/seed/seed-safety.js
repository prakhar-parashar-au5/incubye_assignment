// Guards for the destructive seed. Checked before any file or database work.

export const SEED_APP_ENVS = Object.freeze(['development', 'test', 'demo']);

export class SeedRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

/**
 * @param {{ replace: boolean, appEnv: string | undefined }} options
 * @throws {SeedRefusedError}
 */
export function assertSeedAllowed({ replace, appEnv }) {
  if (appEnv === 'production') {
    throw new SeedRefusedError('refusing to seed: APP_ENV=production. The seed deletes all employee and compensation data');
  }
  if (!SEED_APP_ENVS.includes(appEnv)) {
    throw new SeedRefusedError(`refusing to seed: APP_ENV must be one of ${SEED_APP_ENVS.join(', ')}`);
  }
  if (replace !== true) {
    throw new SeedRefusedError('refusing to seed without --replace. The seed deletes all employee and compensation data');
  }
}
