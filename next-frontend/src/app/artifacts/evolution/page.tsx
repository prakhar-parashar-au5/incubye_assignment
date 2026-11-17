import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactsHeading, RepoPath } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { MILESTONES, commitHref } from "@/lib/artifacts-more";

export const metadata: Metadata = { title: "Evolution", robots: { index: false, follow: false } };

const SUBTITLE = "Commits and merges on master, oldest first, as recorded. Each links to its commit on GitHub.";

// Built from next-frontend/src/artifacts/evolution.json, which the operator generates from the
// Git history. The frontend runs no Git; the file is read when the app is built.
export default function EvolutionPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Evolution" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/evolution`}>
        {() => (
          <>
            <ArtifactsHeading title="Evolution" subtitle={SUBTITLE} />
            <ol aria-label="Commits and merges" className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
              {MILESTONES.map((milestone, index) => (
                <li key={milestone.hash} className="grid gap-1 py-3 text-sm sm:grid-cols-[3rem_6.5rem_minmax(0,1fr)_6rem] sm:items-baseline sm:gap-x-4">
                  <span className="text-[0.8125rem] text-muted-foreground tabular-nums">{index + 1}</span>
                  <time dateTime={milestone.date} className="text-[0.8125rem] tabular-nums">{milestone.date}</time>
                  <span className={/^merge:/i.test(milestone.title) ? "font-semibold text-pretty" : "text-pretty"}>{milestone.title}</span>
                  <a href={commitHref(milestone.hash)} className="font-mono text-[0.8125rem] text-primary underline underline-offset-4 sm:text-right" aria-label={`Commit ${milestone.hash} on GitHub`}>
                    {milestone.hash}
                  </a>
                </li>
              ))}
            </ol>
            <p className="mt-4 max-w-3xl text-[0.8125rem] text-muted-foreground">
              Merges are in bold. Source: <RepoPath path="next-frontend/src/artifacts/evolution.json" />, supplied by the operator from the Git history. Checkpoints A to C are defined in <RepoPath path="docs/24-parallel-worktree-and-ai-evaluation-plan.md" />.
            </p>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
