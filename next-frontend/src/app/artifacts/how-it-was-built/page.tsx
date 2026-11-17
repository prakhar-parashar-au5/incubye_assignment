import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { ArtifactsGate } from "@/components/artifacts/artifacts-gate";
import { ArtifactsHeading, RepoPath, Sources } from "@/components/artifacts/artifacts-ui";
import { AppShellSkeleton } from "@/components/shell/app-shell";
import { ARTIFACTS_HREF } from "@/lib/artifacts";
import { FLAKY_EXAMPLE, ROLES, WORKED_EXAMPLE, type Step } from "@/lib/artifacts-content";

export const metadata: Metadata = { title: "How it was built", robots: { index: false, follow: false } };

const SUBTITLE = "One orchestrator and specialist agents, each in its own worktree, passing tasks and evidence as files. Prakhar decided product rules and ran Git.";

export default function HowItWasBuiltPage() {
  return (
    <Suspense fallback={<AppShellSkeleton><ArtifactsHeading title="How it was built" subtitle={SUBTITLE} /></AppShellSkeleton>}>
      <ArtifactsGate retryHref={`${ARTIFACTS_HREF}/how-it-was-built`}>
        {() => (
          <>
            <ArtifactsHeading title="How it was built" subtitle={SUBTITLE} />
            <div className="mt-8 max-w-3xl space-y-10 text-sm leading-relaxed">
              <Section id="roles" title="Roles">
                <ul className="divide-y divide-line border-y border-line">
                  {ROLES.map((item) => (
                    <li key={item.role} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-6">
                      <p className="font-semibold">{item.role}</p>
                      <div className="min-w-0 space-y-1">
                        <p>{item.does}</p>
                        <Sources sources={[item.source]} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="isolation" title="Isolation">
                <Bullets>
                  <li>One git worktree per lane, each with its own MySQL container, database, and ports, so one lane&apos;s destructive tests cannot reset another&apos;s data. See <RepoPath path="docs/24-parallel-worktree-and-ai-evaluation-plan.md" /> (Worktree lanes, Database isolation) and <RepoPath path="builder_docs/parent_instructions/08b-local-database-isolation.md" />.</li>
                  <li>Testers run a frozen commit as production builds, never a dev server, so builder edits cannot change the app mid-test. See <RepoPath path="docs/24-parallel-worktree-and-ai-evaluation-plan.md" /> (Freeze procedure).</li>
                  <li>Agents do not run Git. Prakhar reviews an accepted slice and commits it, and nothing is committed until it has been tested. See <RepoPath path="docs/26-multi-agent-build-journey.md" /> (Where Prakhar comes in).</li>
                </Bullets>
              </Section>

              <Section id="contracts" title="Contracts between agents">
                <Bullets>
                  <li>Each task is a markdown file in a lane&apos;s <code>tasks/</code> folder naming the goal, owned files, forbidden areas, tests, and the response path. The agent answers in <code>responses/</code> with files changed, tests, commands, and results, then stops. For example <RepoPath path="builder_docs/frontend-builder/tasks/07-artifacts-section.md" />.</li>
                  <li>A blocker is written up before any workaround, with evidence, the decision needed, and a safe next step, in the lane&apos;s <code>issues/</code> folder. See <RepoPath path="docs/27-agent-blocker-reporting-protocol.md" />.</li>
                </Bullets>
              </Section>

              <Section id="safety" title="Safety rules">
                <Bullets>
                  <li>No agent reads or creates <code>.env</code> files, and no key, cookie, database URL, or password goes into Git, reports, screenshots, or prompts. The OpenAI key is typed into the evaluator&apos;s backend process through hidden terminal input. See <RepoPath path="docs/24-parallel-worktree-and-ai-evaluation-plan.md" /> (Secret handling).</li>
                  <li>Docker Compose is run with <code>COMPOSE_DISABLE_ENV_FILE=1</code>, so it cannot read a <code>.env</code> file on its own. See <RepoPath path="express-backend/package.json" /> (<code>db:up</code>) and <RepoPath path="docs/18-review-findings-and-decisions.md" />.</li>
                  <li>The evaluator fixture commands and the demo data import refuse <code>APP_ENV=production</code> and any database whose name does not end in <code>_test</code> or <code>_demo</code>, and they are dry runs unless given <code>--apply</code>. See <RepoPath path="express-backend/src/evaluation/fixture-guard.ts" /> and <RepoPath path="express-backend/scripts/eval-oracle-fixtures.ts" />.</li>
                </Bullets>
              </Section>

              <Section id="worked-example" title="Worked example: two assistant hard-gate failures">
                <Timeline steps={WORKED_EXAMPLE} />
              </Section>

              <Section id="flaky-test" title="Second example: a flaky test">
                <Timeline steps={FLAKY_EXAMPLE} />
              </Section>
            </div>
          </>
        )}
      </ArtifactsGate>
    </Suspense>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-[0.9375rem] font-semibold">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-muted-foreground [&_li]:text-pretty">{children}</ul>;
}

/** An ordered timeline in the turn-ledger style: a fixed "Step n" column and a ruled body. */
function Timeline({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {steps.map((step, index) => (
        <li key={step.title} className="grid gap-1 py-4 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-4">
          <p className="text-[0.8125rem] text-muted-foreground tabular-nums">Step {index + 1}</p>
          <div className="min-w-0 space-y-1.5">
            <h3 className="font-semibold">{step.title}</h3>
            <p className="text-pretty">{step.body}</p>
            <Sources sources={step.sources} />
          </div>
        </li>
      ))}
    </ol>
  );
}
