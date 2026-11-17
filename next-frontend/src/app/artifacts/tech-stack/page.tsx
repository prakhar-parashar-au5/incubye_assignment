import type { Metadata } from "next";
import { Suspense } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactsHeading, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { DECISIONS, STACK } from "@/lib/artifacts-content";

export const metadata: Metadata = { title: "Tech stack", robots: { index: false, follow: false } };

const SUBTITLE = "Each layer, the version in the package.json files, and why. Every row links to the files that show it.";

export default function TechStackPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="Tech stack" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/tech-stack`}>
        {() => (
          <>
            <ArtifactsHeading title="Tech stack" subtitle={SUBTITLE} />

            {/* Desktop: one table. Phones: one ruled block per layer, so the page never scrolls sideways. */}
            <div className="mt-8 hidden max-w-6xl lg:block">
              <table className="w-full border-collapse text-left text-[0.8125rem] leading-snug">
                <caption className="sr-only">Tech stack by layer</caption>
                <thead className="bg-[#ece8e0] text-xs">
                  <tr>
                    {["Layer", "Choice", "Version", "Why", "Shown in"].map((label) => (
                      <th key={label} scope="col" className="px-3 py-2.5 font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STACK.map((row) => (
                    <tr key={row.layer} className="border-t border-line align-top">
                      <th scope="row" className="w-36 px-3 py-3 font-semibold">
                        {row.layer}
                      </th>
                      <td className="px-3 py-3">{row.choice}</td>
                      <td className="w-48 px-3 py-3 tabular-nums">{row.version}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.why}</td>
                      <td className="w-64 px-3 py-3">
                        <Sources sources={row.sources} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-label="Tech stack by layer" className="mt-6 divide-y divide-line border-y border-line lg:hidden">
              {STACK.map((row) => (
                <li key={row.layer} className="space-y-1.5 py-4 text-sm">
                  <h2 className="text-[0.9375rem] font-semibold">{row.layer}</h2>
                  <p>{row.choice}</p>
                  <p className="text-[0.8125rem] tabular-nums">{row.version}</p>
                  <p className="text-muted-foreground">{row.why}</p>
                  <Sources sources={row.sources} />
                </li>
              ))}
            </ul>

            <section aria-labelledby="decisions" className="mt-10 max-w-3xl">
              <h2 id="decisions" className="text-[0.9375rem] font-semibold">
                Key decisions and their trade-offs
              </h2>
              <ol className="mt-3 divide-y divide-line border-y border-line">
                {DECISIONS.map((item) => (
                  <li key={item.decision} className="space-y-1.5 py-4 text-sm">
                    <p className="font-medium">{item.decision}</p>
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Trade-off: </span>
                      {item.tradeOff}
                    </p>
                    <Sources sources={[item.source]} />
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}
