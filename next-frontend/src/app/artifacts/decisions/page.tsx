import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactsHeading, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { DECISION_CARDS } from "@/lib/artifacts-more";

export const metadata: Metadata = { title: "Decisions and trade-offs", robots: { index: false, follow: false } };

const SUBTITLE = "Each decision with the options considered, why this one was chosen, and what it costs. Every entry links to its source.";

export default function DecisionsPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Decisions and trade-offs" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/decisions`}>
        {() => (
          <>
            <ArtifactsHeading title="Decisions and trade-offs" subtitle={SUBTITLE} />
            <ol aria-label="Decisions" className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
              {DECISION_CARDS.map((card, index) => (
                <li key={card.title} className="py-5 text-sm">
                  <h2 className="text-[0.9375rem] font-semibold text-balance">
                    <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}.</span>
                    {card.title}
                  </h2>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                    {[
                      ["Decision", card.decision],
                      ["Options considered", card.options],
                      ["Why", card.why],
                      ["Cost", card.cost],
                    ].map(([label, text]) => (
                      <div key={label} className="contents">
                        <dt className="text-[0.8125rem] font-medium text-muted-foreground">{label}</dt>
                        <dd className="text-pretty">{text}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3">
                    <Sources sources={card.sources} />
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
