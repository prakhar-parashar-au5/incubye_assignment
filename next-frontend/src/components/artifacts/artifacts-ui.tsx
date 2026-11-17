import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { ARTIFACT_GROUPS, ARTIFACTS_HREF, rawHref, repoHref, type ArtifactCard } from "@/lib/artifacts";
import { NOT_ON_MASTER, type Source } from "@/lib/artifacts-content";
import { cn } from "@/lib/utils";

// Presentational parts of the Artifacts section. No data access here, so they render in tests.
// Layout follows the AI monitoring pages: ruled records and plain lists, no card wall.

export function ArtifactsHeading({ title, subtitle, back = true }: { title: string; subtitle: string; back?: boolean }) {
  return (
    <div className="max-w-3xl">
      {back ? (
        <Link href={ARTIFACTS_HREF} className="text-sm font-medium text-primary underline underline-offset-4">
          ← Artifacts
        </Link>
      ) : null}
      <h1 className={cn("text-[1.75rem] leading-tight font-semibold tracking-[-0.015em] text-balance", back && "mt-4")}>{title}</h1>
      <p className="mt-1.5 text-[0.9375rem] text-pretty text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/**
 * The overview: three short groups (Thinking, How it works, Quality and history), each a ruled
 * list with one entry per artifact: a title, one sentence, and a link. An entry whose page is not
 * available yet is plain text marked "Coming soon", never a link.
 */
export function ArtifactCardList({ cards, available }: { cards: readonly ArtifactCard[]; available: ReadonlySet<string> }) {
  return (
    <nav aria-label="Artifacts" className="mt-8 max-w-3xl space-y-8">
      {ARTIFACT_GROUPS.map((group) => {
        const inGroup = cards.filter((card) => card.group === group);
        if (inGroup.length === 0) return null;
        const id = `group-${group.toLowerCase().replace(/[^a-z]+/g, "-")}`;
        return (
          <section key={group} aria-labelledby={id}>
            <h2 id={id} className="text-[0.9375rem] font-semibold">
              {group}
            </h2>
            <ul aria-labelledby={id} className="mt-2 divide-y divide-line border-y border-line">
              {inGroup.map((card) => {
                const ready = !card.pending && (!card.file || available.has(card.file));
                return (
                  <li key={card.href} className="grid gap-1 py-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-x-6">
                    <div className="min-w-0">
                      <h3 className="text-[0.9375rem] font-semibold">
                        {ready ? (
                          <Link href={card.href} className="text-primary underline underline-offset-4">
                            {card.title}
                          </Link>
                        ) : (
                          card.title
                        )}
                      </h3>
                      <p className="mt-1 text-sm text-pretty text-muted-foreground">{card.summary}</p>
                    </div>
                    <p className="text-[0.8125rem] text-muted-foreground sm:text-right">
                      {card.label}
                      {ready ? null : <span className="block font-medium text-foreground">Coming soon</span>}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

/**
 * A generated page in a sandboxed iframe. `sandbox` with no tokens: no scripts, no forms, no
 * popups, and an opaque origin, on top of the raw route's own CSP.
 */
export function ArtifactFrame({ file, title }: { file: string; title: string }) {
  return (
    <section aria-label={title} className="mt-6 max-w-[90rem]">
      <p className="mb-3 text-sm">
        <a href={rawHref(file)} className="inline-flex items-center gap-1.5 font-medium text-primary underline underline-offset-4">
          Open full page
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
        <span className="ml-2 text-muted-foreground">The diagram is wide; scroll inside the frame, or open it on its own.</span>
      </p>
      <iframe
        src={rawHref(file)}
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        className="block h-[75vh] min-h-[28rem] w-full rounded-md border border-line bg-surface"
      />
    </section>
  );
}

export function ComingSoon({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <section className="mt-8 max-w-2xl rounded-md border border-line bg-[#e6ecf8] p-4" aria-labelledby="coming-soon">
      <h2 id="coming-soon" className="text-[0.9375rem] font-semibold">
        Coming soon
      </h2>
      <p className="mt-1 text-sm">{children ?? `${what} has not been generated yet. It will appear here once the architecture pages are synced.`}</p>
    </section>
  );
}

/** A link to a file in the GitHub repository. The visible text is the path, so it can be checked. */
export function RepoPath({ path, children }: { path: string; children?: ReactNode }) {
  return (
    <a href={repoHref(path)} className="font-medium text-primary underline underline-offset-4 [overflow-wrap:anywhere]">
      {children ?? <code className="text-[0.8125rem]">{path}</code>}
    </a>
  );
}

/**
 * The files that back a claim. A path that is not on master yet is shown as text with a note,
 * not as a link that would 404 on GitHub.
 */
export function Sources({ sources }: { sources: readonly Source[] }) {
  return (
    <ul aria-label="Sources" className="space-y-1 text-[0.8125rem]">
      {sources.map((source) => (
        <li key={`${source.path}${source.note ?? ""}`} className="min-w-0">
          {NOT_ON_MASTER.has(source.path) ? (
            <code className="[overflow-wrap:anywhere]">{source.path}</code>
          ) : (
            <RepoPath path={source.path} />
          )}
          {source.note ? <span className="text-muted-foreground"> · {source.note}</span> : null}
          {NOT_ON_MASTER.has(source.path) ? <span className="text-muted-foreground"> (not on master yet)</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A titled section on a written artifact page. */
export function ArtifactSection({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("mt-10 max-w-3xl text-sm leading-relaxed", className)}>
      <h2 id={id} className="text-[0.9375rem] font-semibold">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
