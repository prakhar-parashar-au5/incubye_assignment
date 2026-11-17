import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactSection, ArtifactsHeading, RepoPath, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { SALARY_EXAMPLE, SPEC_PAIRS } from "@/lib/artifacts-more";

export const metadata: Metadata = { title: "Human specs and AI specs", robots: { index: false, follow: false } };

const SUBTITLE = "docs_human/ holds Prakhar’s own specs and decisions. The agents built the designs, test plans, and tasks in docs/ and the task files from them.";

export default function SpecsPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Human specs and AI specs" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/specs`}>
        {() => (
          <>
            <ArtifactsHeading title="Human specs and AI specs" subtitle={SUBTITLE} />

            <div className="mt-8 hidden max-w-6xl lg:block">
              <table className="w-full border-collapse text-left text-[0.8125rem] leading-snug">
                <caption className="sr-only">Each human spec and the agent documents built from it</caption>
                <thead className="bg-[#ece8e0] text-xs">
                  <tr>
                    {["Topic", "Human spec", "Agent documents", "How the pairing is shown"].map((label) => (
                      <th key={label} scope="col" className="px-3 py-2.5 font-semibold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SPEC_PAIRS.map((pair) => (
                    <tr key={pair.human} className="border-t border-line align-top">
                      <th scope="row" className="w-40 px-3 py-3 font-semibold">{pair.topic}</th>
                      <td className="w-72 px-3 py-3"><RepoPath path={pair.human} /></td>
                      <td className="px-3 py-3">
                        <ul className="space-y-1">{pair.agent.map((path) => <li key={path}><RepoPath path={path} /></li>)}</ul>
                      </td>
                      <td className="w-56 px-3 py-3 text-muted-foreground">{pair.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-label="Human specs and agent documents" className="mt-6 divide-y divide-line border-y border-line lg:hidden">
              {SPEC_PAIRS.map((pair) => (
                <li key={pair.human} className="space-y-1.5 py-4 text-sm">
                  <h2 className="text-[0.9375rem] font-semibold">{pair.topic}</h2>
                  <p className="text-[0.8125rem]"><span className="text-muted-foreground">Human: </span><RepoPath path={pair.human} /></p>
                  <ul className="space-y-1 text-[0.8125rem]">{pair.agent.map((path) => <li key={path}><span className="text-muted-foreground">Agent: </span><RepoPath path={path} /></li>)}</ul>
                  <p className="text-[0.8125rem] text-muted-foreground">{pair.basis}</p>
                </li>
              ))}
            </ul>

            <ArtifactSection id="salary-human" title="Example, salary adjustments: what the human decided">
              <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
                {SALARY_EXAMPLE.human.map((point) => <li key={point} className="text-pretty">{point}</li>)}
              </ul>
              <div className="mt-2"><Sources sources={SALARY_EXAMPLE.humanSources} /></div>
            </ArtifactSection>
            <ArtifactSection id="salary-agents" title="What the agents added">
              <ul className="divide-y divide-line border-y border-line">
                {SALARY_EXAMPLE.agents.map((item) => (
                  <li key={item.added} className="space-y-1.5 py-3">
                    <p className="text-pretty">{item.added}</p>
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
