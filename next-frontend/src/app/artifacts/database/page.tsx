import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactFrame, ArtifactsHeading, ComingSoon } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF, SCHEMA_FILE } from "@/lib/artifacts";
import { availableArtifacts } from "@/server/artifacts";

export const metadata: Metadata = { title: "Database schema", robots: { index: false, follow: false } };

const SUBTITLE = "Every MySQL table and foreign key, generated from the migration files, not from a live database.";

export default function DatabasePage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Database schema" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/database`}>
        {async () => (
          <>
            <ArtifactsHeading title="Database schema" subtitle={SUBTITLE} />
            {(await availableArtifacts()).has(SCHEMA_FILE) ? <ArtifactFrame file={SCHEMA_FILE} title="Database schema" /> : <ComingSoon what="The database schema page" />}
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
