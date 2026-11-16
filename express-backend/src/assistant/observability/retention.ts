import { PersistenceValidationError } from './validation.js';

export interface RetentionOptions { days: number; execute: boolean }

export function retentionCutoff(days: number, now: Date): string {
  if (!Number.isSafeInteger(days) || days < 1 || !Number.isFinite(now.getTime())) throw new PersistenceValidationError('invalid retention cutoff');
  return new Date(now.getTime() - days * 86_400_000).toISOString().replace('T', ' ').replace('Z', '');
}

export interface RetentionStore {
  retentionCounts(cutoff: string): Promise<{ traces: number; unownedMessages: number; mcpCalls: number }>;
  deleteExpired(cutoff: string): Promise<{ traces: number; unownedMessages: number; mcpCalls: number; conversations: number }>;
}

export async function runRetention(store: RetentionStore, options: RetentionOptions, now: Date) {
  const cutoff = retentionCutoff(options.days, now);
  const counts = await store.retentionCounts(cutoff);
  const deleted = options.execute ? await store.deleteExpired(cutoff) : null;
  return { cutoff, counts, deleted };
}

export function parseRetentionArgs(args: readonly string[], production: boolean): RetentionOptions {
  const allowed = new Set(['--retention-days', '--execute', '--allow-short-retention', '--acknowledge-production']);
  if (args.some((arg) => arg.startsWith('--') && !allowed.has(arg))) throw new PersistenceValidationError('unknown retention option');
  const positions = args.flatMap((arg, index) => arg === '--retention-days' ? [index] : []);
  if (positions.length !== 1 || positions[0] === undefined) throw new PersistenceValidationError('retention-days is required once');
  const index = positions[0];
  const raw = args[index + 1];
  if (!raw || !/^[1-9]\d*$/.test(raw)) throw new PersistenceValidationError('retention-days must be a positive integer');
  const days = Number(raw);
  if (!Number.isSafeInteger(days)) throw new PersistenceValidationError('retention-days is out of range');
  if (args.filter((arg) => arg === '--execute').length > 1 || args.filter((arg) => arg === '--allow-short-retention').length > 1 || args.filter((arg) => arg === '--acknowledge-production').length > 1 || args.length !== (2 + Number(args.includes('--execute')) + Number(args.includes('--allow-short-retention')) + Number(args.includes('--acknowledge-production')))) {
    throw new PersistenceValidationError('invalid retention options');
  }
  if (days < 30 && !args.includes('--allow-short-retention')) throw new PersistenceValidationError('retention below 30 days requires explicit override');
  const execute = args.includes('--execute');
  if (production && execute && !args.includes('--acknowledge-production')) throw new PersistenceValidationError('production deletion requires acknowledgement');
  return { days, execute };
}
