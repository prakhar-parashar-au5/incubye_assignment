import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactCardList, ArtifactsHeading } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACT_CARDS, ARTIFACTS_HREF } from "@/lib/artifacts";
import { availableArtifacts } from "@/server/artifacts";

export const metadata: Metadata = { title: "Artifacts", robots: { index: false, follow: false } };

const SUBTITLE = "How the system works and how it was built. Static pages with no employee data.";

export default function ArtifactsOverviewPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading back={false} title="Artifacts" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={ARTIFACTS_HREF}>
        {async () => (
          <>
            <ArtifactsHeading back={false} title="Artifacts" subtitle={SUBTITLE} />
            <ArtifactCardList cards={ARTIFACT_CARDS} available={await availableArtifacts()} />
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
