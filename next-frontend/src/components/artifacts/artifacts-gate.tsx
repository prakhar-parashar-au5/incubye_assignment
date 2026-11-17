import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { ForbiddenState, ServiceUnavailable } from "@/components/shell/page-states";
import { identityOf, loadSessionAndToken, requireUser } from "@/server/protected";

// Server-side Admin HR check for every Artifacts page. The current user comes from the backend
// (getCurrentUser, through the shared per-request session) on every request. Signed-out and
// expired sessions redirect as on other pages; Scoped HR gets the forbidden state and none of the
// page content is rendered.
export async function ArtifactsGate({ retryHref, children }: { retryHref: string; children: () => ReactNode | Promise<ReactNode> }) {
  const { session } = await loadSessionAndToken();
  const user = requireUser(session);
  if (!user) {
    return (
      <AppShell identity={null} current="artifacts">
        <ServiceUnavailable retryHref={retryHref} />
      </AppShell>
    );
  }
  if (user.role !== "ADMIN") {
    return (
      <AppShell identity={identityOf(user)} current="artifacts">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Artifacts</h1>
        <ForbiddenState area="Artifacts" />
      </AppShell>
    );
  }
  return (
    <AppShell identity={identityOf(user)} current="artifacts">
      {await children()}
    </AppShell>
  );
}
