import { createObservabilityRepository } from '../src/assistant/observability/repository.js';
import { parseRetentionArgs, runRetention } from '../src/assistant/observability/retention.js';
import { createPool } from '../src/db/connection.js';

async function main(): Promise<void> {
  const production = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
  const options = parseRetentionArgs(process.argv.slice(2), production);
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const result = await runRetention(createObservabilityRepository(pool), options, new Date());
    process.stdout.write(`${JSON.stringify({ mode: options.execute ? 'execute' : 'dry-run', cutoff: result.cutoff, counts: result.counts, deleted: result.deleted })}\n`);
  } finally { await pool.end(); }
}

main().catch(() => {
  process.stderr.write('AI retention failed; no trace content or connection details are printed.\n');
  process.exitCode = 1;
});
