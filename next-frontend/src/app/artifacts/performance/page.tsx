import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactSection, ArtifactsHeading, RepoPath, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { PERFORMANCE_DOC, PERFORMANCE_FINDINGS, PERFORMANCE_NEXT, PERFORMANCE_SETUP, PERFORMANCE_TABLES, type MeasuredTable } from "@/lib/artifacts-more";

export const metadata: Metadata = { title: "Performance", robots: { index: false, follow: false } };

const SUBTITLE = "Measured numbers only, from the backend performance run. Times are in milliseconds for the whole service call.";

export default function PerformancePage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Performance" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/performance`}>
        {() => (
          <>
            <ArtifactsHeading title="Performance" subtitle={SUBTITLE} />
            <p className="mt-4 max-w-3xl text-sm">
              Full write-up, with every measured query and plan: <RepoPath path={PERFORMANCE_DOC} />
            </p>

            <ArtifactSection id="perf-setup" title="How it was measured">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                {PERFORMANCE_SETUP.map((item) => (
                  <div key={item.label} className="contents">
                    <dt className="text-[0.8125rem] font-medium text-muted-foreground">{item.label}</dt>
                    <dd className="text-pretty">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </ArtifactSection>

            {PERFORMANCE_TABLES.map((table) => (
              <ArtifactSection key={table.id} id={table.id} title={table.title} className="max-w-5xl">
                <Measured table={table} />
                <div className="mt-2"><Sources sources={table.sources} /></div>
              </ArtifactSection>
            ))}

            <ArtifactSection id="perf-findings" title="What the numbers show">
              <ul className="divide-y divide-line border-y border-line">
                {PERFORMANCE_FINDINGS.map((item) => (
                  <li key={item.title} className="space-y-1.5 py-3">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-pretty">{item.body}</p>
                    <Sources sources={item.sources} />
                  </li>
                ))}
              </ul>
            </ArtifactSection>

            <ArtifactSection id="perf-next" title="At ten times the data">
              <p className="text-muted-foreground">{PERFORMANCE_NEXT.note}</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
                {PERFORMANCE_NEXT.items.map((item) => <li key={item} className="text-pretty">{item}</li>)}
              </ul>
              <div className="mt-2"><Sources sources={PERFORMANCE_NEXT.sources} /></div>
            </ArtifactSection>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}

/** Desktop: a table. Phones: one ruled block per query, so the page never scrolls sideways. */
function Measured({ table }: { table: MeasuredTable }) {
  return (
    <>
      <table className="hidden w-full border-collapse text-left text-[0.8125rem] leading-snug md:table">
        <caption className="sr-only">{table.caption}</caption>
        <thead className="bg-[#ece8e0] text-xs">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-semibold">Query</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Rows examined</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">p50 ms</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">p95 ms</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Note</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.query} className="border-t border-line align-top">
              <th scope="row" className="px-3 py-2.5 font-medium">{row.query}</th>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.rows}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.p50}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.p95}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul aria-label={table.caption} className="divide-y divide-line border-y border-line md:hidden">
        {table.rows.map((row) => (
          <li key={row.query} className="space-y-1 py-3 text-[0.8125rem]">
            <p className="text-sm font-medium">{row.query}</p>
            <p className="tabular-nums">p50 {row.p50} ms · p95 {row.p95} ms · {row.rows} rows examined</p>
            {row.note ? <p className="text-muted-foreground">{row.note}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
