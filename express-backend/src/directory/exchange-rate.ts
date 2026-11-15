// The saved official USD/INR snapshot. No live rate request is made.
// Direction is fixed and checked: base USD, quote INR, so 1 USD = rate INR
// and an INR amount converts to USD by dividing by the rate.
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { isPositiveDecimal } from '../money/decimal.js';
import { EXCHANGE_RATE_FILE } from '../paths.js';

const SnapshotFile = z.object({
  baseCurrency: z.literal('USD'),
  quoteCurrency: z.literal('INR'),
  rate: z.string().refine(isPositiveDecimal),
  sourceName: z.string().min(1),
  sourceUrl: z.url({ protocol: /^https$/ }),
  effectiveDate: z.iso.date(),
  retrievedAt: z.iso.datetime(),
});

export type ExchangeRateSnapshot = z.infer<typeof SnapshotFile>;

export function parseExchangeRateSnapshot(value: unknown): ExchangeRateSnapshot {
  const parsed = SnapshotFile.safeParse(value);
  if (!parsed.success) throw new Error('invalid exchange-rate snapshot');
  return parsed.data;
}

export async function loadExchangeRate(file: string = EXCHANGE_RATE_FILE): Promise<ExchangeRateSnapshot> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  return parseExchangeRateSnapshot(parsed);
}
