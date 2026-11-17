import 'server-only';

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { ARTIFACT_FILES, isArtifactFile } from '@/lib/artifacts';
import { api } from '@/server/api/client';
import { resolveSession, type HrUser } from '@/server/session';
import { readSessionToken } from '@/server/session-cookie';

// Server side of the Artifacts section. There is no backend API for it, so the frontend server
// is the authority: every request asks the backend who the current user is (getCurrentUser) and
// allows Admin HR only. Hiding the rail item is presentation.

/** The committed copy written by `npm run artifacts:sync`. `next start` runs from next-frontend/. */
// turbopackIgnore: the directory is read at run time, so the build must not trace the whole project
// for it. Nothing here uses output: 'standalone'; `next start` serves from the full checkout.
export const ARTIFACT_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), 'src', 'artifacts', 'generated');

export type ArtifactAccess =
  | { kind: 'allowed'; user: HrUser }
  | { kind: 'signed-out' }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'forbidden'; user: HrUser };

/** Admin HR check for the raw file route. Pages use the same rule through the shared session. */
export async function artifactAccess(): Promise<ArtifactAccess> {
  const session = await resolveSession(await readSessionToken(), api());
  if (session.kind !== 'signed-in') return session;
  return session.user.role === 'ADMIN' ? { kind: 'allowed', user: session.user } : { kind: 'forbidden', user: session.user };
}

/**
 * Reads one generated page. The name must be on the allowlist; it is never joined into a path
 * otherwise, so `..`, encoded separators, and other names cannot reach the file system.
 */
export async function readArtifact(name: string, dir: string = ARTIFACT_DIR): Promise<string | null> {
  if (!isArtifactFile(name)) return null;
  try {
    return await readFile(path.join(/* turbopackIgnore: true */ dir, name), 'utf8');
  } catch {
    return null;
  }
}

/** Which allowlisted pages have been synced. F3 and the schema page arrive later. */
export async function availableArtifacts(dir: string = ARTIFACT_DIR): Promise<ReadonlySet<string>> {
  const present = await Promise.all(
    ARTIFACT_FILES.map(async (name) => {
      try {
        return (await stat(path.join(/* turbopackIgnore: true */ dir, name))).isFile() ? name : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(present.filter((name): name is string => name !== null));
}

/**
 * Headers for every raw response. The generated pages are static HTML with inline styles and
 * inline SVG only (no <img>, fonts, or links to other files), so nothing else is allowed: no
 * scripts, no network requests, no forms, no plugins. Add `img-src` only if a page starts to need it.
 */
export const RAW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

export function rawHeaders(contentType: string): Headers {
  return new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': RAW_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
}
