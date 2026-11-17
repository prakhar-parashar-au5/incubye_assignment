import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Info } from "lucide-react";

import { MonitoringHeading, RecordLine, SectionHeading, StatusLabel } from "@/components/ai-monitoring/monitoring-ui";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ForbiddenState, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CALL_STATUS_LABELS,
  MONITORING_HREF,
  SUMMARY_WINDOWS,
  VERDICT_LABELS,
  WINDOW_LABELS,
  bucketLabel,
  callTone,
  formatDuration,
  formatNumber,
  listHref,
  mcpListLink,
  pivotCalls,
  stageLabel,
  summaryWindow,
  traceListLink,
  windowDates,
  TRACES_HREF,
  type CallStatus,
  type TraceSummary,
} from "@/lib/ai-monitoring";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

// AI monitoring Overview: built only from GET /api/v1/admin/ai-traces/summary. Ruled records and
// plain tables, no card wall. Every count that has a matching trace or MCP list filter links to
// that list; counts without one (durations, tokens, review verdicts) are plain text.

export const metadata: Metadata = { title: "AI monitoring", robots: { index: false, follow: false } };

const SUBTITLE = "Recorded assistant turns and MCP calls. Synthetic data, kept for 30 days.";

export default function MonitoringOverviewPage({ searchParams }: PageProps<"/admin/ai-monitoring">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <MonitoringHeading view="overview" title="AI monitoring" subtitle={SUBTITLE} />
          <div className="mt-8 flex max-w-5xl flex-col gap-3" aria-busy="true">
            <p role="status" className="text-sm text-muted-foreground">
              Loading the monitoring summary…
            </p>
            <Skeleton aria-hidden="true" className="h-14 w-full animate-none bg-muted" />
            <Skeleton aria-hidden="true" className="h-40 w-full animate-none bg-muted" />
          </div>
        </AppShellSkeleton>
      }
    >
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ searchParams }: { searchParams: PageProps<"/admin/ai-monitoring">["searchParams"] }) {
  const [{ window: windowParam }, { session, token }] = await Promise.all([searchParams, loadSessionAndToken()]);
  const window = summaryWindow(windowParam);
  const result = token ? await api().getAdminAiTraceSummary(token, window) : null;
  const user = requireUser(session);
  redirectIfUnauthenticated(result && !result.ok ? result.kind : undefined);
  const retry = window === "24h" ? MONITORING_HREF : `${MONITORING_HREF}?window=${window}`;
  const heading = <MonitoringHeading view="overview" title="AI monitoring" subtitle={SUBTITLE} />;

  if (!user) {
    return (
      <AppShell identity={null} current="monitoring">
        {heading}
        <ServiceUnavailable retryHref={retry} />
      </AppShell>
    );
  }
  let body: ReactNode;
  if (!result || !result.ok) {
    body =
      result?.kind === "FORBIDDEN" ? (
        <ForbiddenState area="AI monitoring" />
      ) : result?.kind === "INVALID_RESPONSE" ? (
        <div className="mt-8">
          <UnexpectedResponse retryHref={retry} />
        </div>
      ) : (
        <ServiceUnavailable retryHref={retry} />
      );
  } else {
    body = <SummaryView summary={result.data} />;
  }
  return (
    <AppShell identity={identityOf(user)} current="monitoring">
      {heading}
      {body}
    </AppShell>
  );
}

function CountLink({ href, value, label, className }: { href: string; value: number; label: string; className?: string }) {
  return (
    <Link href={href} aria-label={`${formatNumber(value)} ${label}, open in the trace list`} className={cn("font-medium text-primary tabular-nums underline-offset-4 hover:underline", className)}>
      {formatNumber(value)}
    </Link>
  );
}

function McpCountLink({ href, value, label }: { href: string; value: number; label: string }) {
  if (value === 0) return <span className="text-muted-foreground tabular-nums">0</span>;
  return (
    <Link href={href} aria-label={`${formatNumber(value)} ${label}, open in the MCP call list`} className="font-medium text-primary tabular-nums underline-offset-4 hover:underline">
      {formatNumber(value)}
    </Link>
  );
}

const th = "border-b border-line px-2.5 py-2 text-left text-[0.75rem] font-semibold text-muted-foreground";
const td = "border-b border-line px-2.5 py-2 align-top";
const num = "text-right tabular-nums";

function WindowSwitch({ current }: { current: TraceSummary["window"] }) {
  return (
    <nav aria-label="Summary window" className="flex flex-wrap gap-1">
      {SUMMARY_WINDOWS.map((window) => (
        <Link
          key={window}
          href={window === "24h" ? MONITORING_HREF : `${MONITORING_HREF}?window=${window}`}
          aria-current={window === current ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-medium sm:min-h-8",
            window === current ? "border-primary bg-accent text-foreground" : "border-input bg-surface text-foreground hover:bg-[#faf9f6]",
          )}
        >
          {WINDOW_LABELS[window]}
        </Link>
      ))}
    </nav>
  );
}

function SummaryView({ summary }: { summary: TraceSummary }) {
  const { traces } = summary;
  const dates = windowDates(summary);
  const empty = traces.total === 0;
  return (
    <div className="mt-6 flex max-w-6xl flex-col gap-10">
      <section aria-labelledby="window-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading id="window-heading">Window</SectionHeading>
          <WindowSwitch current={summary.window} />
        </div>
        <RecordLine
          items={[
            { label: "From", value: formatDateTime(summary.from) },
            { label: "To", value: formatDateTime(summary.to) },
            { label: "Generated", value: formatDateTime(summary.generatedAt) },
          ]}
        />
        <p className="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Counts cover exactly this window. The trace list filters by whole UTC days, so its links cover {dates.from === dates.to ? dates.from : `${dates.from} to ${dates.to}`} and can include a few
            traces just outside the window.
          </span>
        </p>
      </section>

      <section aria-labelledby="traces-heading" className="flex flex-col gap-3">
        <SectionHeading id="traces-heading">Assistant turns</SectionHeading>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-t border-line pt-3 sm:flex sm:flex-wrap sm:items-end">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Traces</dt>
            <dd className="text-[1.75rem] leading-tight font-semibold">
              <CountLink href={traceListLink(summary)} value={traces.total} label="traces" className="text-foreground" />
            </dd>
          </div>
          {(
            [
              ["Completed", traces.completed, "COMPLETED", "ok"],
              ["Failed", traces.failed, "FAILED", "error"],
              ["In progress", traces.started, "STARTED", "muted"],
            ] as const
          ).map(([label, value, status, tone]) => (
            <div key={status}>
              <dt className="text-[0.8125rem] text-muted-foreground">
                <StatusLabel tone={tone}>{label}</StatusLabel>
              </dt>
              <dd className="text-[1.125rem] font-semibold">
                <CountLink href={traceListLink(summary, { status })} value={value} label={`${label.toLowerCase()} traces`} />
              </dd>
            </div>
          ))}
        </dl>
        {empty ? <p className="text-sm text-muted-foreground">No assistant turns were recorded in this window.</p> : null}
      </section>

      <Series summary={summary} />

      <div className="grid gap-10 xl:grid-cols-2">
        <section aria-labelledby="failures-heading" className="flex min-w-0 flex-col gap-3">
          <SectionHeading id="failures-heading">Failures by stage and category</SectionHeading>
          {summary.failures.length === 0 ? (
            <p className="border-t border-line pt-3 text-sm text-muted-foreground">No failed turns in this window.</p>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Failures by stage and category table">
              <table className="w-full border-collapse text-[0.8125rem]">
                <thead>
                  <tr>
                    <th className={th}>Stage</th>
                    <th className={th}>Error category</th>
                    <th className={cn(th, "text-right")}>Traces</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.failures.map((row, index) => (
                    <tr key={`${row.failureStage}-${row.errorCategory}-${index}`}>
                      <td className={td}>{stageLabel(row.failureStage) ?? "Not recorded"}</td>
                      <td className={cn(td, "break-all")}>{row.errorCategory ?? "—"}</td>
                      <td className={cn(td, num)}>
                        {row.errorCategory ? (
                          <CountLink href={traceListLink(summary, { status: "FAILED", errorCategory: row.errorCategory })} value={row.count} label={`failed traces with category ${row.errorCategory}`} />
                        ) : (
                          formatNumber(row.count)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[0.75rem] text-muted-foreground">Links filter by error category; the trace list has no stage filter.</p>
            </div>
          )}
        </section>

        <section aria-labelledby="timing-heading" className="flex min-w-0 flex-col gap-3">
          <SectionHeading id="timing-heading">Duration and tokens</SectionHeading>
          <RecordLine
            items={[
              { label: "Median (p50)", value: formatDuration(summary.durationMs.p50) },
              { label: "p95", value: formatDuration(summary.durationMs.p95) },
              { label: "Slowest", value: formatDuration(summary.durationMs.max) },
              { label: "Completed turns measured", value: formatNumber(summary.durationMs.completedCount) },
            ]}
          />
          <RecordLine
            items={[
              { label: "Input tokens", value: formatNumber(summary.tokens.input) },
              { label: "Output tokens", value: formatNumber(summary.tokens.output) },
              { label: "Reasoning tokens (count only)", value: formatNumber(summary.tokens.reasoning) },
              { label: "Total (input + output)", value: formatNumber(summary.tokens.total) },
            ]}
          />
          <p className="text-[0.75rem] text-muted-foreground">
            Durations are exact nearest-rank percentiles over completed turns. These are measurements, not correctness verdicts.
          </p>
        </section>

        <section aria-labelledby="models-heading" className="flex min-w-0 flex-col gap-3">
          <SectionHeading id="models-heading">Model calls by model</SectionHeading>
          {summary.modelCalls.byModel.length === 0 ? (
            <p className="border-t border-line pt-3 text-sm text-muted-foreground">No model calls in this window.</p>
          ) : (
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr>
                  <th className={th}>Model</th>
                  <th className={cn(th, "text-right")}>Model calls</th>
                  <th className={cn(th, "text-right")}>Traces</th>
                </tr>
              </thead>
              <tbody>
                {summary.modelCalls.byModel.map((row) => (
                  <tr key={row.model}>
                    <td className={cn(td, "break-all")}>{row.model}</td>
                    <td className={cn(td, num)}>{formatNumber(row.count)}</td>
                    <td className={cn(td, "text-right")}>
                      <Link href={traceListLink(summary, { model: row.model })} className="font-medium text-primary underline-offset-4 hover:underline">
                        View traces<span className="sr-only"> using {row.model}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="px-2.5 py-2 font-medium">All models</td>
                  <td className={cn("px-2.5 py-2 font-medium", num)}>{formatNumber(summary.modelCalls.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section aria-labelledby="reviews-heading" className="flex min-w-0 flex-col gap-3">
          <SectionHeading id="reviews-heading">Reviews</SectionHeading>
          <RecordLine
            items={[
              ...(["CORRECT", "PARTIAL", "INCORRECT"] as const).map((verdict) => ({
                label: VERDICT_LABELS[verdict],
                value: formatNumber(summary.reviews.byVerdict.find((row) => row.verdict === verdict)?.count ?? 0),
              })),
              { label: "Not reviewed", value: formatNumber(summary.reviews.unreviewed) },
            ]}
          />
          <p className="text-[0.75rem] text-muted-foreground">The trace list has no review filter, so these counts are not links.</p>
        </section>

        <CallPivot
          id="tools-heading"
          title="Assistant tool calls"
          empty="No assistant tool calls in this window."
          rows={summary.toolCalls}
          linkTotal={(tool) => traceListLink(summary, { tool })}
          linkCell={null}
          note="Tool names link to traces that called the tool; the trace list has no tool-status filter."
        />
        <CallPivot
          id="mcp-heading"
          title="MCP calls"
          empty="No MCP calls in this window."
          rows={summary.mcpCalls}
          linkTotal={(tool) => mcpListLink(summary, { tool })}
          linkCell={(tool, status) => mcpListLink(summary, { tool, status })}
          note="MCP calls come from MCP clients and do not use the language model."
        />
      </div>
    </div>
  );
}

const STATUS_ORDER: CallStatus[] = ["SUCCEEDED", "REJECTED", "FAILED", "STARTED"];

function CallPivot({
  id,
  title,
  empty,
  rows,
  linkTotal,
  linkCell,
  note,
}: {
  id: string;
  title: string;
  empty: string;
  rows: TraceSummary["toolCalls"];
  linkTotal: (tool: string) => string;
  linkCell: ((tool: string, status: CallStatus) => string) | null;
  note: string;
}) {
  const pivot = pivotCalls(rows);
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <SectionHeading id={id}>{title}</SectionHeading>
      {pivot.length === 0 ? (
        <p className="border-t border-line pt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} table`}>
          <table className="w-full border-collapse text-[0.8125rem]">
            <thead>
              <tr>
                <th className={th}>Tool</th>
                {STATUS_ORDER.map((status) => (
                  <th key={status} className={cn(th, "text-right")}>
                    <StatusLabel tone={callTone(status)}>{CALL_STATUS_LABELS[status]}</StatusLabel>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pivot.map((row) => (
                <tr key={row.toolName}>
                  <td className={cn(td, "whitespace-nowrap")}>
                    <Link href={linkTotal(row.toolName)} className="font-medium text-primary underline-offset-4 hover:underline">
                      {row.toolName}
                    </Link>
                    <span className="ml-1.5 text-muted-foreground tabular-nums">({formatNumber(row.total)})</span>
                  </td>
                  {STATUS_ORDER.map((status) => (
                    <td key={status} className={cn(td, num)}>
                      {linkCell ? (
                        <McpCountLink href={linkCell(row.toolName, status)} value={row.counts[status]} label={`${row.toolName} calls ${CALL_STATUS_LABELS[status].toLowerCase()}`} />
                      ) : (
                        <span className={row.counts[status] === 0 ? "text-muted-foreground" : undefined}>{formatNumber(row.counts[status])}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[0.75rem] text-muted-foreground">{note}</p>
        </div>
      )}
    </section>
  );
}

function Series({ summary }: { summary: TraceSummary }) {
  const { points, bucket } = summary.series;
  const max = Math.max(1, ...points.map((point) => point.traces));
  const unit = bucket === "HOUR" ? "hour" : "day";
  const busiest = points.reduce<(typeof points)[number] | null>((best, point) => (point.traces > (best?.traces ?? 0) ? point : best), null);
  return (
    <section aria-labelledby="series-heading" className="flex flex-col gap-3">
      <SectionHeading id="series-heading">Traces and failures by {unit} (UTC)</SectionHeading>
      <p className="text-[0.8125rem] text-muted-foreground">
        {busiest ? `Busiest ${unit}: ${bucketLabel(busiest.start, bucket)}, ${formatNumber(busiest.traces)} traces, ${formatNumber(busiest.failures)} failed.` : `No traces in any ${unit} of this window.`}
      </p>
      {/* The bars repeat the table below for sighted readers; the table carries the values. */}
      <div aria-hidden="true" className="flex h-32 items-end gap-px border-b border-line">
        {points.map((point) => {
          const height = (point.traces / max) * 100;
          const failed = point.traces === 0 ? 0 : (point.failures / point.traces) * 100;
          return (
            <div key={point.start} className="flex h-full min-w-0 flex-1 items-end" title={`${bucketLabel(point.start, bucket)}: ${point.traces} traces, ${point.failures} failed`}>
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-[2px] bg-primary" style={{ height: `${height}%` }}>
                <div className="w-full bg-destructive" style={{ height: `${failed}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[0.75rem] text-muted-foreground" aria-hidden="true">
        <span>
          <span className="mr-1.5 inline-block size-2 bg-primary align-middle" />
          Traces
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2 bg-destructive align-middle" />
          Failed
        </span>
      </div>
      <details className="text-[0.8125rem]">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-primary sm:min-h-8">Values by {unit}</summary>
        <div className="mt-2 max-h-96 overflow-auto" tabIndex={0} role="region" aria-label={`Traces and failures by ${unit} table`}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{bucket === "HOUR" ? "Hour starting" : "Day"}</th>
                <th className={cn(th, "text-right")}>Traces</th>
                <th className={cn(th, "text-right")}>Failed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => {
                const day = point.start.slice(0, 10);
                return (
                  <tr key={point.start}>
                    <td className={td}>{bucketLabel(point.start, bucket)}</td>
                    <td className={cn(td, num)}>
                      {point.traces === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <CountLink href={listHref(TRACES_HREF, { from: day, to: day }, false)} value={point.traces} label={`traces on ${day}`} />
                      )}
                    </td>
                    <td className={cn(td, num)}>
                      {point.failures === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <CountLink href={listHref(TRACES_HREF, { from: day, to: day, status: "FAILED" }, false)} value={point.failures} label={`failed traces on ${day}`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {bucket === "HOUR" ? <p className="mt-2 text-[0.75rem] text-muted-foreground">Hourly links open the whole UTC day.</p> : null}
        </div>
      </details>
    </section>
  );
}
