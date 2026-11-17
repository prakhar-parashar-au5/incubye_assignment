import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactSection, ArtifactsHeading, RepoPath, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { EVAL_DEFECTS, EVAL_GATES, EVAL_METHOD, EVAL_RECHECK, EVAL_REPORT, EVAL_RUN } from "@/lib/artifacts-more";

export const metadata: Metadata = { title: "AI evaluation", robots: { index: false, follow: false } };

const SUBTITLE = "Live evaluation 01 of the assistant: how it was run, the results, the two hard-gate failures (pass-or-fail checks that block acceptance), and their fix.";

export default function AiEvaluationPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="AI evaluation" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/ai-evaluation`}>
        {() => (
          <>
            <ArtifactsHeading title="AI evaluation" subtitle={SUBTITLE} />
            <p className="mt-4 max-w-3xl text-sm">
              Full report: <RepoPath path={EVAL_REPORT} />
            </p>

            <ArtifactSection id="eval-method" title="Method">
              <ul className="divide-y divide-line border-y border-line">
                {EVAL_METHOD.map((item) => (
                  <li key={item.title} className="space-y-1.5 py-3">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-pretty">{item.body}</p>
                    <Sources sources={item.sources} />
                  </li>
                ))}
              </ul>
            </ArtifactSection>

            <ArtifactSection id="eval-run" title="The run">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                {EVAL_RUN.map((item) => (
                  <div key={item.label} className="contents">
                    <dt className="text-[0.8125rem] font-medium text-muted-foreground">{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2"><Sources sources={[{ path: EVAL_REPORT, note: "sections 1 and 2" }]} /></div>
            </ArtifactSection>

            <ArtifactSection id="eval-results" title="Hard-gate results">
              <table className="w-full border-collapse text-left text-[0.8125rem] leading-snug">
                <caption className="sr-only">Hard-gate results of live evaluation 01</caption>
                <thead className="bg-[#ece8e0] text-xs">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Gate</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {EVAL_GATES.map((row) => (
                    <tr key={row.gate} className="border-t border-line align-top">
                      <th scope="row" className="px-3 py-3 font-medium">{row.gate}</th>
                      <td className="px-3 py-3">{row.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-muted-foreground">Verdict: not acceptable as-is, because D1 and D2 reproduce. Quality scores (0 to 3) for each case are in section 4 of the report.</p>
              <div className="mt-2"><Sources sources={[{ path: EVAL_REPORT, note: "sections 3, 4, and 11" }]} /></div>
            </ArtifactSection>

            <ArtifactSection id="eval-defects" title="D1 and D2, and the fix">
              <ul className="divide-y divide-line border-y border-line">
                {EVAL_DEFECTS.map((item) => (
                  <li key={item.id} className="space-y-1.5 py-3">
                    <h3 className="font-semibold">{item.id}</h3>
                    <p className="text-pretty"><span className="font-medium">Found: </span>{item.finding}</p>
                    <p className="text-pretty"><span className="font-medium">Fix: </span>{item.fix}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <Sources sources={[{ path: EVAL_REPORT, note: "section 8" }, { path: "builder_docs/ai-builder/tasks/05-eval-01-hard-gate-fixes.md" }, { path: "builder_docs/ai-builder/responses/05-eval-01-hard-gate-fixes.md" }]} />
              </div>
            </ArtifactSection>

            <ArtifactSection id="eval-recheck" title="Re-check">
              <p className="text-pretty">{EVAL_RECHECK.status}</p>
              <div className="mt-2"><Sources sources={EVAL_RECHECK.sources} /></div>
            </ArtifactSection>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
