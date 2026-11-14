// Server configuration from the injected environment, validated with Zod.
// Never reads .env files. Error messages name variables, never values.
import { Buffer } from 'node:buffer';
import { z } from 'zod';

import { CLIENT_IP_SOURCES } from './rate-limit.js';
import type { ClientIpSource } from './rate-limit.js';

export interface ServerConfig {
  databaseUrl: string;
  jwtSigningKey: string;
  port: number;
  clientIpSource: ClientIpSource;
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().refine((value) => {
    try {
      return new URL(value).protocol === 'mysql:';
    } catch {
      return false;
    }
  }),
  JWT_SIGNING_KEY: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32),
  PORT: z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(0).max(65535)).default(3000),
  CLIENT_IP_SOURCE: z.enum(CLIENT_IP_SOURCES).default('socket'),
});

export function readServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const parsed = EnvSchema.safeParse({
    DATABASE_URL: env.DATABASE_URL,
    JWT_SIGNING_KEY: env.JWT_SIGNING_KEY,
    PORT: env.PORT,
    CLIENT_IP_SOURCE: env.CLIENT_IP_SOURCE,
  });
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new Error(`invalid server configuration: ${names.join(', ')} (missing or invalid)`);
  }
  const { DATABASE_URL, JWT_SIGNING_KEY, PORT, CLIENT_IP_SOURCE } = parsed.data;
  return { databaseUrl: DATABASE_URL, jwtSigningKey: JWT_SIGNING_KEY, port: PORT, clientIpSource: CLIENT_IP_SOURCE };
}
