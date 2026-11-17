import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { ActiveFilters, FilterForm, InvalidFilters, Pagination, ResultsLine, ScrollTable, td, th, type FilterField } from "@/components/ai-monitoring/list-parts";
import { MonitoringHeading, StatusLabel } from "@/components/ai-monitoring/monitoring-ui";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ForbiddenState, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TRACES_HREF,
  TRACE_STATUS_LABELS,
  formatDuration,
  formatNumber,
  listHref,
  parseTraceQuery,
  stageLabel,
  traceTone,
  type TraceListItem,
  type TraceOptions,
  type TraceQuery,
} from "@/lib/ai-monitoring";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

// Admin trace list: an investigation ledger. Server-side filters and pagination (25 default, 100
// maximum), newest first. Rows carry no prompts, answers, arguments, or results.

export const metadata: Metadata = { title: "AI traces", robots: { index: false, follow: false } };

const SUBTITLE = "Recorded assistant turns, newest first. Synthetic data, kept for 30 days.";

export default function TraceListPage({ searchParams }: PageProps<"/admin/ai-traces">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <MonitoringHeading view="traces" title="AI traces" subtitle={SUBTITLE} />
          <div className="mt-8 flex max-w-6xl flex-col gap-2" aria-busy="true">
            <p role="status" className="text-sm text-muted-foreground">
              Loading traces…
            </p>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} aria-hidden="true" className="h-9 w-full animate-none bg-muted" />
            ))}
          </div>
        </AppShellSkeleton>
      }
    >
      <TraceList searchParams={searchParams} />
    </Suspense>
  );
}

async function TraceList({ searchParams }: { searchParams: PageProps<"/admin/ai-traces">["searchParams"] }) {
  const [params, { session, token }] = await Promise.all([searchParams, loadSessionAndToken()]);
  const parsed = parseTraceQuery(params);
  const client = api();
  const [list, options] = await Promise.all([
    token && parsed.ok ? client.listAdminAiTraces(token, parsed.query) : Promise.resolve(null),
    token ? client.getAdminAiTraceOptions(token) : Promise.resolve(null),
  ]);
  const user = requireUser(session);
  redirectIfUnauthenticated(list && !list.ok ? list.kind : undefined, options && !options.ok ? options.kind : undefined);
  const heading = <MonitoringHeading view="traces" title="AI traces" subtitle={SUBTITLE} />;
  if (!user) {
    return (
      <AppShell identity={null} current="monitoring">
        {heading}
        <ServiceUnavailable retryHref={TRACES_HREF} />
      </AppShell>
    );
  }
  const forbidden = (list && !list.ok && list.kind === "FORBIDDEN") || (options && !options.ok && options.kind === "FORBIDDEN");
  if (forbidden) {
    return (
      <AppShell identity={identityOf(user)} current="monitoring">
        {heading}
        <ForbiddenState area="AI traces" />
      </AppShell>
    );
  }

  const query: TraceQuery = parsed.ok ? parsed.query : {};
  const opts = options?.ok ? options.data : null;
  const fields = filterFields(query, opts);
  const pageSize = query.pageSize ?? 25;
  let results: ReactNode;
  if (!parsed.ok || (list && !list.ok && list.kind === "VALIDATION_ERROR")) {
    results = <InvalidFilters clearHref={TRACES_HREF} />;
  } else if (!list || !list.ok) {
    const retry = listHref(TRACES_HREF, query, false);
    results = list?.kind === "INVALID_RESPONSE" ? <UnexpectedResponse retryHref={retry} /> : <ServiceUnavailable retryHref={retry} className="max-w-2xl" />;
  } else {
    const { traces, page } = list.data;
    const back = listHref(TRACES_HREF, query, false);
    const filtered = Object.keys(query).some((key) => key !== "page" && key !== "pageSize");
    results = (
      <div className="flex flex-col gap-4">
        <ResultsLine noun="trace" totalRows={page.totalRows} page={page.number} totalPages={page.totalPages} />
        {traces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {filtered ? "No traces match these filters." : "No assistant traces have been recorded in the last 30 days."}{" "}
            {filtered ? (
              <Link href={TRACES_HREF} className="font-medium text-primary underline underline-offset-4">
                Clear all
              </Link>
            ) : null}
          </p>
        ) : (
          <>
            <TraceTable traces={traces} back={back} />
            <TraceItems traces={traces} back={back} />
          </>
        )}
        <Pagination base={TRACES_HREF} query={query} page={page.number} totalPages={page.totalPages} />
      </div>
    );
  }

  const userName = (id: string) => opts?.hrUsers.find((u) => String(u.id) === id)?.displayName ?? `HR user ${id}`;
  return (
    <AppShell identity={identityOf(user)} current="monitoring">
      {heading}
      <div className="mt-6 flex max-w-6xl flex-col gap-6">
        <FilterForm action={TRACES_HREF} fields={fields} pageSize={pageSize} clearHref={TRACES_HREF} />
        {parsed.ok ? (
          <ActiveFilters
            base={TRACES_HREF}
            query={query}
            labels={{
              from: (v) => `From ${v}`,
              to: (v) => `To ${v}`,
              hrUserId: (v) => `HR user: ${userName(v)}`,
              status: (v) => `Status: ${TRACE_STATUS_LABELS[v as keyof typeof TRACE_STATUS_LABELS] ?? v}`,
              model: (v) => `Model: ${v}`,
              tool: (v) => `Tool: ${v}`,
              errorCategory: (v) => `Error: ${v}`,
            }}
          />
        ) : null}
        {results}
      </div>
    </AppShell>
  );
}

function filterFields(query: TraceQuery, options: TraceOptions | null): FilterField[] {
  const keep = (values: string[], current: string | undefined) => (current && !values.includes(current) ? [...values, current] : values);
  const plain = (values: string[]) => values.map((value) => ({ value, label: value }));
  const users = options?.hrUsers.map((u) => ({ value: String(u.id), label: u.displayName })) ?? [];
  if (query.hrUserId && !users.some((u) => u.value === String(query.hrUserId))) users.push({ value: String(query.hrUserId), label: `HR user ${query.hrUserId}` });
  return [
    { kind: "date", name: "from", label: "From (UTC date)", value: query.from },
    { kind: "date", name: "to", label: "To (UTC date)", value: query.to },
    { kind: "select", name: "hrUserId", label: "HR user", value: query.hrUserId ? String(query.hrUserId) : undefined, choices: users, unavailable: !options },
    {
      kind: "select",
      name: "status",
      label: "Status",
      value: query.status,
      choices: (["COMPLETED", "FAILED", "STARTED"] as const).map((s) => ({ value: s, label: TRACE_STATUS_LABELS[s] })),
    },
    { kind: "select", name: "model", label: "Model", value: query.model, choices: plain(keep(options?.models ?? [], query.model)), unavailable: !options },
    { kind: "select", name: "tool", label: "Tool", value: query.tool, choices: plain(keep(options?.toolNames ?? [], query.tool)), unavailable: !options },
    {
      kind: "select",
      name: "errorCategory",
      label: "Error category",
      value: query.errorCategory,
      choices: plain(keep(options?.errorCategories ?? [], query.errorCategory)),
      unavailable: !options,
    },
  ];
}

function detailHref(trace: TraceListItem, back: string): string {
  return `${TRACES_HREF}/${trace.traceId}${back !== TRACES_HREF ? `?back=${encodeURIComponent(back)}` : ""}`;
}

function rowName(trace: TraceListItem): string {
  return `Trace started ${formatDateTime(trace.startedAt)} by ${trace.hrUser.displayName}, ${TRACE_STATUS_LABELS[trace.status]}`;
}

function Tokens({ trace }: { trace: TraceListItem }) {
  return (
    <span className="tabular-nums">
      in {formatNumber(trace.inputTokens)} · out {formatNumber(trace.outputTokens)} · reasoning {formatNumber(trace.reasoningTokens)}
    </span>
  );
}

function ErrorCell({ trace }: { trace: TraceListItem }) {
  if (!trace.failureStage && !trace.errorCategory) return null;
  return (
    <span className="flex flex-col">
      <span>{stageLabel(trace.failureStage)}</span>
      {trace.errorCategory ? <span className="text-muted-foreground [overflow-wrap:anywhere]">{trace.errorCategory}</span> : null}
    </span>
  );
}

function TraceTable({ traces, back }: { traces: TraceListItem[]; back: string }) {
  return (
    <ScrollTable label="AI traces table">
      <table className="w-full min-w-[68rem] border-collapse text-[0.8125rem]">
        <caption className="sr-only">AI traces, newest first</caption>
        <thead>
          <tr>
            {["Started (UTC)", "HR user", "Status", "Model", "Tools", "Duration", "Tokens", "Calls", "Error"].map((label) => (
              <th key={label} scope="col" className={cn(th, label === "Duration" && "text-right")}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => (
            <tr key={trace.traceId}>
              <td className={cn(td, "whitespace-nowrap")}>
                <Link href={detailHref(trace, back)} aria-label={rowName(trace)} className="font-medium text-primary underline-offset-4 hover:underline">
                  {formatDateTime(trace.startedAt)}
                </Link>
              </td>
              <td className={td}>{trace.hrUser.displayName}</td>
              <td className={td}>
                <StatusLabel tone={traceTone(trace.status)}>{TRACE_STATUS_LABELS[trace.status]}</StatusLabel>
              </td>
              <td className={cn(td, "[overflow-wrap:anywhere]")}>{trace.model}</td>
              <td className={cn(td, "max-w-56 [overflow-wrap:anywhere]")}>{trace.toolNames.length ? trace.toolNames.join(", ") : <span className="text-muted-foreground">None</span>}</td>
              <td className={cn(td, "text-right whitespace-nowrap tabular-nums")}>{formatDuration(trace.durationMs)}</td>
              <td className={cn(td, "whitespace-nowrap")}>
                <Tokens trace={trace} />
              </td>
              <td className={cn(td, "whitespace-nowrap tabular-nums")}>
                {formatNumber(trace.modelCallCount)} model · {formatNumber(trace.toolCallCount)} tool
              </td>
              <td className={cn(td, "max-w-64")}>
                <ErrorCell trace={trace} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function TraceItems({ traces, back }: { traces: TraceListItem[]; back: string }) {
  return (
    <ol aria-label="AI traces, newest first" className="flex flex-col border-t border-line lg:hidden">
      {traces.map((trace) => (
        <li key={trace.traceId} className="flex flex-col gap-1 border-b border-line py-3 text-[0.8125rem]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Link href={detailHref(trace, back)} aria-label={rowName(trace)} className="min-h-6 font-medium text-primary underline-offset-4 hover:underline">
              {formatDateTime(trace.startedAt)}
            </Link>
            <StatusLabel tone={traceTone(trace.status)}>{TRACE_STATUS_LABELS[trace.status]}</StatusLabel>
          </div>
          <p>
            {trace.hrUser.displayName} · <span className="[overflow-wrap:anywhere]">{trace.model}</span>
          </p>
          <p className="text-muted-foreground [overflow-wrap:anywhere]">Tools: {trace.toolNames.length ? trace.toolNames.join(", ") : "None"}</p>
          <p className="text-muted-foreground">
            {formatDuration(trace.durationMs)} · <Tokens trace={trace} /> · {formatNumber(trace.modelCallCount)} model · {formatNumber(trace.toolCallCount)} tool
          </p>
          {trace.failureStage || trace.errorCategory ? (
            <p className="text-destructive">
              <ErrorCell trace={trace} />
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
