import { artifactAccess, rawHeaders, readArtifact } from '@/server/artifacts';

// Serves one generated architecture page for the Artifacts iframes and "Open full page".
// Order matters: the Admin HR check runs before the name is looked at, so a Scoped HR or signed-out
// request learns nothing about which files exist.
export async function GET(_request: Request, { params }: RouteContext<'/artifacts/raw/[name]'>) {
  const access = await artifactAccess();
  if (access.kind === 'signed-out' || access.kind === 'expired') return text(401, 'Sign in as Admin HR to view this artifact.');
  if (access.kind === 'unavailable') return text(503, 'The service is not responding. Try again in a moment.');
  if (access.kind === 'forbidden') return text(403, 'Admin HR only.');

  const { name } = await params;
  const html = await readArtifact(name);
  if (html === null) return text(404, 'Artifact not found.');
  return new Response(html, { status: 200, headers: rawHeaders('text/html; charset=utf-8') });
}

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: rawHeaders('text/plain; charset=utf-8') });
}
