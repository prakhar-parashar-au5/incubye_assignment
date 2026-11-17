import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactFrame, ArtifactsHeading, ComingSoon } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF, flowBySlug } from "@/lib/artifacts";
import { availableArtifacts } from "@/server/artifacts";

export const metadata: Metadata = { title: "Request flow", robots: { index: false, follow: false } };

export default function FlowPage({ params }: PageProps<"/artifacts/flows/[flow]">) {
  return (
    <Suspense fallback={<AppShellSkeleton><div className="h-8 w-48 rounded bg-muted" /></AppShellSkeleton>}>
      <Flow params={params} />
    </Suspense>
  );
}

async function Flow({ params }: { params: PageProps<"/artifacts/flows/[flow]">["params"] }) {
  const { flow: slug } = await params;
  const flow = flowBySlug(slug);
  if (!flow) notFound();
  return (
    <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/flows/${flow.slug}`}>
      {async () => {
        const ready = (await availableArtifacts()).has(flow.file);
        return (
          <>
            <ArtifactsHeading title={`${flow.code}: ${flow.title}`} subtitle={flow.summary} />
            {ready ? <ArtifactFrame file={flow.file} title={`Request flow ${flow.code}: ${flow.title}`} /> : <ComingSoon what={`Request flow ${flow.code}`} />}
          </>
        );
      }}
    </ArtifactsGate>
  );
}
