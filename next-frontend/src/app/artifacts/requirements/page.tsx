import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactSection, ArtifactsHeading, RepoPath, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { REQUIREMENTS, REQUIREMENTS_CHANGES, REQUIREMENTS_ORIGINAL, REQUIREMENTS_SOURCE } from "@/lib/artifacts-more";

export const metadata: Metadata = { title: "Requirements", robots: { index: false, follow: false } };

const SUBTITLE = "A summary of the one-page requirements. The full text is linked below.";

export default function RequirementsPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Requirements" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/requirements`}>
        {() => (
          <>
            <ArtifactsHeading title="Requirements" subtitle={SUBTITLE} />
            <div className="mt-6 max-w-3xl rounded-md border border-line bg-[#e6ecf8] p-4 text-sm">
              <p className="font-semibold">Written before implementation</p>
              <p className="mt-1">
                Full text: <RepoPath path={REQUIREMENTS_SOURCE} />. It expands Prakhar&apos;s original note, <RepoPath path={REQUIREMENTS_ORIGINAL} />.
              </p>
            </div>
            {REQUIREMENTS.map((section, index) => (
              <ArtifactSection key={section.heading} id={`req-${index}`} title={section.heading}>
                <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
                  {section.points.map((point) => (
                    <li key={point} className="text-pretty">{point}</li>
                  ))}
                </ul>
              </ArtifactSection>
            ))}
            <ArtifactSection id="req-changes" title="What changed after it was written">
              <ul className="divide-y divide-line border-y border-line">
                {REQUIREMENTS_CHANGES.map((item) => (
                  <li key={item.change} className="space-y-1.5 py-3">
                    <p className="text-pretty">{item.change}</p>
                    <Sources sources={item.sources} />
                  </li>
                ))}
              </ul>
            </ArtifactSection>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
