import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactSection, ArtifactsHeading, RepoPath, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { TESTING_COVERAGE, TESTING_DOC, TESTING_LAYERS, TESTING_POINTS, TESTS_THAT_MATTER } from "@/lib/artifacts-more";

export const metadata: Metadata = { title: "Testing", robots: { index: false, follow: false } };

const SUBTITLE = "Each test layer with the counts and run times measured on 2026-11-17, coverage, and five tests that matter.";

export default function TestingPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Testing" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/testing`}>
        {() => (
          <>
            <ArtifactsHeading title="Testing" subtitle={SUBTITLE} />
            <p className="mt-4 max-w-3xl text-sm">
              Full write-up: <RepoPath path={TESTING_DOC} />. Counts are as recorded there; later tasks have added tests since.
            </p>

            <ArtifactSection id="test-layers" title="Layers">
              <ul className="divide-y divide-line border-y border-line">
                {TESTING_LAYERS.map((layer) => (
                  <li key={layer.layer} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-6">
                    <div className="min-w-0">
                      <h3 className="font-semibold">{layer.layer}</h3>
                      <p className="text-[0.8125rem] text-muted-foreground"><code>{layer.command}</code></p>
                    </div>
                    <div className="min-w-0 text-[0.8125rem] tabular-nums">
                      <p>{layer.tests}</p>
                      <p>{layer.result}</p>
                      <p className="text-muted-foreground">{layer.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2"><Sources sources={[{ path: TESTING_DOC, note: "Inventory per layer" }, { path: "builder_docs/backend-builder/responses/13-evidence/backend-fast-tests.txt" }, { path: "builder_docs/backend-builder/responses/13-evidence/backend-db-tests-summary.txt" }, { path: "builder_docs/backend-builder/responses/13-evidence/frontend-unit-tests-summary.txt" }]} /></div>
            </ArtifactSection>

            <ArtifactSection id="test-coverage" title="Coverage">
              <table className="w-full border-collapse text-left text-[0.8125rem] leading-snug">
                <caption className="sr-only">Line and branch coverage by suite</caption>
                <thead className="bg-[#ece8e0] text-xs">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Suite</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Lines</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Branches</th>
                  </tr>
                </thead>
                <tbody>
                  {TESTING_COVERAGE.map((row) => (
                    <tr key={row.suite} className="border-t border-line align-top">
                      <th scope="row" className="px-3 py-2.5 font-medium">{row.suite}</th>
                      <td className="px-3 py-2.5 tabular-nums">{row.lines}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.branches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-muted-foreground">Measured with Node&apos;s built-in coverage. Branches count only inside code that ran, so read them next to lines.</p>
              <div className="mt-2"><Sources sources={[{ path: TESTING_DOC, note: "Coverage" }, { path: "builder_docs/backend-builder/responses/13-evidence/backend-fast-coverage.txt" }, { path: "builder_docs/backend-builder/responses/13-evidence/backend-db-coverage.txt" }]} /></div>
            </ArtifactSection>

            <ArtifactSection id="test-design" title="How the suites stay reliable">
              <ul className="divide-y divide-line border-y border-line">
                {TESTING_POINTS.map((item) => (
                  <li key={item.title} className="space-y-1.5 py-3">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-pretty">{item.body}</p>
                    <Sources sources={item.sources} />
                  </li>
                ))}
              </ul>
            </ArtifactSection>

            <ArtifactSection id="test-five" title="Five tests that matter">
              <ol className="divide-y divide-line border-y border-line">
                {TESTS_THAT_MATTER.map((test, index) => (
                  <li key={test.name} className="grid gap-1 py-3 sm:grid-cols-[2rem_minmax(0,1fr)]">
                    <span className="text-[0.8125rem] text-muted-foreground tabular-nums">{index + 1}.</span>
                    <div className="min-w-0 space-y-1">
                      <h3 className="font-semibold text-pretty">“{test.name}”</h3>
                      <p className="text-pretty">{test.proves}</p>
                      <Sources sources={[test.source]} />
                    </div>
                  </li>
                ))}
              </ol>
            </ArtifactSection>

            <ArtifactSection id="test-ai" title="The AI evaluation is a separate layer">
              <p className="text-pretty">
                The automated tests prove the assistant&apos;s machinery with a fake model. Whether a real model picks the right tool and describes the result honestly is checked by the live evaluation, described on the AI evaluation page.
              </p>
              <div className="mt-2"><Sources sources={[{ path: TESTING_DOC, note: "The AI evaluation: a separate layer" }]} /></div>
            </ArtifactSection>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
