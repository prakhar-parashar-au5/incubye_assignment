import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, CircleAlert, Info } from "lucide-react";

import { DeletePanel, DeletionFrame } from "@/components/ai-monitoring/delete-panel";
import { MonitoringHeading, RecordLine, StatusLabel } from "@/components/ai-monitoring/monitoring-ui";
import { ReviewPanel } from "@/components/ai-monitoring/review-panel";
import { TurnLedger, stoppedStepIndex } from "@/components/ai-monitoring/turn-ledger";
import { ViewSwitch } from "@/components/ai-monitoring/view-switch";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ForbiddenState, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TRACES_HREF,
  TRACE_STATUS_LABELS,
  formatDuration,
  formatNumber,
  isUuid,
  parseTraceQuery,
  safeBackHref,
  shortId,
  stageLabel,
  traceTone,
  type TraceDetail,
} from "@/lib/ai-monitoring";
import { formatDateTime } from "@/lib/format";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

// One recorded turn: header record, Formatted | Raw JSON, the ordered turn ledger, then the review
// and delete panels (beside the ledger at 1280px and wider). The formatted view is the backend's
// formatted view: employee names, codes, and emails are placeholders; salary values are shown.

export const metadata: Metadata = { title: "AI trace", robots: { index: false, follow: false } };

const SUBTITLE = "One recorded assistant turn, in the order it ran.";

export default function TraceDetailPage({ params, searchParams }: PageProps<"/admin/ai-traces/[traceId]">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <MonitoringHeading view="traces" title="AI trace" subtitle={SUBTITLE} />
          <div className="mt-8 flex max-w-4xl flex-col gap-3" aria-busy="true">
            <p role="status" className="text-sm text-muted-foreground">
              Loading the trace…
            </p>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} aria-hidden="true" className="h-16 w-full animate-none bg-muted" />
            ))}
          </div>
        </AppShellSkeleton>
      }
    >
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: { params: PageProps<"/admin/ai-traces/[traceId]">["params"]; searchParams: PageProps<"/admin/ai-traces/[traceId]">["searchParams"] }) {
  const [{ traceId }, { back: backParam }, { session, token }] = await Promise.all([params, searchParams, loadSessionAndToken()]);
  if (!isUuid(traceId)) notFound();
  const result = token ? await api().getAdminAiTrace(token, traceId, "formatted") : null;
  const user = requireUser(session);
  redirectIfUnauthenticated(result && !result.ok ? result.kind : undefined);
  if (result && !result.ok && result.kind === "NOT_FOUND") notFound();

  const back = safeBackHref(backParam, TRACES_HREF, parseTraceQuery);
  const heading = <MonitoringHeading view="traces" title="AI trace" subtitle={SUBTITLE} />;
  const backLink = (
    <Link href={back} className="mt-5 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
      <ArrowLeft aria-hidden="true" className="size-4" />
      AI traces
    </Link>
  );
  const retry = `${TRACES_HREF}/${traceId}`;
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
        <ForbiddenState area="AI traces" />
      ) : result?.kind === "INVALID_RESPONSE" ? (
        <div className="mt-6">
          <UnexpectedResponse retryHref={retry} />
        </div>
      ) : (
        <ServiceUnavailable retryHref={retry} />
      );
  } else {
    body = <TraceBody detail={result.data} />;
  }
  return (
    <AppShell identity={identityOf(user)} current="monitoring">
      {heading}
      {backLink}
      {body}
    </AppShell>
  );
}

function TraceBody({ detail }: { detail: TraceDetail }) {
  const { trace } = detail;
  const stopped = stoppedStepIndex(detail);
  const started = formatDateTime(trace.startedAt);
  return (
    <DeletionFrame startedAt={started} hrUser={trace.hrUser.displayName}>
      <div className="mt-4 grid gap-10 xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-12">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3">
            <h2 className="text-[1.125rem] font-semibold">
              Trace {shortId(trace.traceId)}
              <span className="ml-2 text-[0.8125rem] font-normal text-muted-foreground [overflow-wrap:anywhere]">{trace.traceId}</span>
            </h2>
            <RecordLine
              items={[
                { label: "Status", value: <StatusLabel tone={traceTone(trace.status)}>{TRACE_STATUS_LABELS[trace.status]}</StatusLabel> },
                { label: "Started", value: started },
                { label: "Duration", value: formatDuration(trace.durationMs) },
                { label: "Model", value: trace.model },
              ]}
            />
            <RecordLine
              items={[
                { label: "HR user", value: trace.hrUser.displayName },
                { label: "Conversation turn", value: formatNumber(trace.turnSequence) },
                { label: "Model calls", value: formatNumber(trace.modelCallCount) },
                { label: "Tool calls", value: formatNumber(trace.toolCallCount) },
                { label: "Tokens in · out · reasoning", value: `${formatNumber(trace.inputTokens)} · ${formatNumber(trace.outputTokens)} · ${formatNumber(trace.reasoningTokens)}` },
              ]}
            />
            <RecordLine
              items={[
                { label: "Prompt version", value: `${trace.promptVersion} · ${trace.promptHash.slice(0, 12)}` },
                { label: "Request ID", value: trace.requestId },
                {
                  label: "Previous turn",
                  value: trace.previousTraceId ? (
                    <Link href={`${TRACES_HREF}/${trace.previousTraceId}`} className="text-primary underline underline-offset-4">
                      Trace {shortId(trace.previousTraceId)}
                    </Link>
                  ) : (
                    "None"
                  ),
                },
                {
                  label: "Next turn",
                  value: trace.nextTraceId ? (
                    <Link href={`${TRACES_HREF}/${trace.nextTraceId}`} className="text-primary underline underline-offset-4">
                      Trace {shortId(trace.nextTraceId)}
                    </Link>
                  ) : (
                    "None"
                  ),
                },
              ]}
            />
            {trace.status === "FAILED" ? (
              <p className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3 py-2 text-[0.8125rem] text-[#7d1a14]">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  Stopped at {stageLabel(trace.failureStage) ?? "an unrecorded stage"}
                  {trace.errorCategory ? `: ${trace.errorCategory}` : ""}.
                </span>
                {stopped ? (
                  <a href={`#step-${stopped}`} className="font-medium underline underline-offset-4">
                    Go to step {stopped}
                  </a>
                ) : null}
              </p>
            ) : null}
            <a href="#review" className="text-sm font-medium text-primary underline underline-offset-4 xl:hidden">
              Go to review
            </a>
          </div>

          <ViewSwitch
            kind="trace"
            id={trace.traceId}
            formatted={
              <div className="flex flex-col gap-3">
                {detail.redaction.note ? (
                  <p className="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
                    <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    {detail.redaction.note}
                  </p>
                ) : null}
                <TurnLedger detail={detail} mode="formatted" />
                <RecordLine
                  items={[
                    { label: "Total duration", value: formatDuration(trace.durationMs) },
                    { label: "Tokens in · out · reasoning", value: `${formatNumber(trace.inputTokens)} · ${formatNumber(trace.outputTokens)} · ${formatNumber(trace.reasoningTokens)}` },
                    { label: "Calls", value: `${formatNumber(trace.modelCallCount)} model · ${formatNumber(trace.toolCallCount)} tool` },
                  ]}
                />
              </div>
            }
          />
        </div>

        <aside aria-label="Review and delete" className="flex min-w-0 flex-col gap-8 xl:sticky xl:top-6 xl:self-start">
          <div id="review" className="scroll-mt-4">
            <ReviewPanel traceId={trace.traceId} review={detail.review} inProgress={trace.status === "STARTED"} />
          </div>
          <DeletePanel
            traceId={trace.traceId}
            startedAt={formatDateTime(trace.startedAt)}
            hrUser={trace.hrUser.displayName}
            status={TRACE_STATUS_LABELS[trace.status]}
            modelCalls={trace.modelCallCount}
            toolCalls={trace.toolCallCount}
            hasReview={detail.review !== null}
          />
        </aside>
      </div>
    </DeletionFrame>
  );
}
