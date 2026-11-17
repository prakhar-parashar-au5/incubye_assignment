import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, Info } from "lucide-react";

import { McpBody } from "@/components/ai-monitoring/mcp-body";
import { MonitoringHeading, RecordLine, StatusLabel } from "@/components/ai-monitoring/monitoring-ui";
import { ViewSwitch } from "@/components/ai-monitoring/view-switch";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ForbiddenState, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import { CALL_STATUS_LABELS, MCP_HREF, VALIDATION_LABELS, callTone, formatDuration, isUuid, parseMcpQuery, safeBackHref, shortId, type McpDetail } from "@/lib/ai-monitoring";
import { formatDateTime } from "@/lib/format";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

export const metadata: Metadata = { title: "MCP call", robots: { index: false, follow: false } };

const SUBTITLE = "One call from an MCP client. No language model was involved.";

export default function McpDetailPage({ params, searchParams }: PageProps<"/admin/mcp-calls/[mcpCallId]">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <MonitoringHeading view="mcp" title="MCP call" subtitle={SUBTITLE} />
          <div className="mt-8 flex max-w-4xl flex-col gap-3" aria-busy="true">
            <p role="status" className="text-sm text-muted-foreground">
              Loading the MCP call…
            </p>
            <Skeleton aria-hidden="true" className="h-16 w-full animate-none bg-muted" />
          </div>
        </AppShellSkeleton>
      }
    >
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: { params: PageProps<"/admin/mcp-calls/[mcpCallId]">["params"]; searchParams: PageProps<"/admin/mcp-calls/[mcpCallId]">["searchParams"] }) {
  const [{ mcpCallId }, { back: backParam }, { session, token }] = await Promise.all([params, searchParams, loadSessionAndToken()]);
  if (!isUuid(mcpCallId)) notFound();
  const result = token ? await api().getAdminMcpToolCall(token, mcpCallId, "formatted") : null;
  const user = requireUser(session);
  redirectIfUnauthenticated(result && !result.ok ? result.kind : undefined);
  if (result && !result.ok && result.kind === "NOT_FOUND") notFound();
  const heading = <MonitoringHeading view="mcp" title="MCP call" subtitle={SUBTITLE} />;
  const back = safeBackHref(backParam, MCP_HREF, parseMcpQuery);
  const retry = `${MCP_HREF}/${mcpCallId}`;
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
        <ForbiddenState area="MCP calls" />
      ) : result?.kind === "INVALID_RESPONSE" ? (
        <div className="mt-6">
          <UnexpectedResponse retryHref={retry} />
        </div>
      ) : (
        <ServiceUnavailable retryHref={retry} />
      );
  } else {
    body = <CallBody detail={result.data} />;
  }
  return (
    <AppShell identity={identityOf(user)} current="monitoring">
      {heading}
      <Link href={back} className="mt-5 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        MCP calls
      </Link>
      {body}
    </AppShell>
  );
}

function CallBody({ detail }: { detail: McpDetail }) {
  const { call } = detail;
  return (
    <div className="mt-4 flex max-w-4xl flex-col gap-5">
      <h2 className="text-[1.125rem] font-semibold">
        MCP call {shortId(call.mcpCallId)}
        <span className="ml-2 text-[0.8125rem] font-normal text-muted-foreground [overflow-wrap:anywhere]">{call.mcpCallId}</span>
      </h2>
      <RecordLine
        items={[
          { label: "Execution", value: <StatusLabel tone={callTone(call.status)}>{CALL_STATUS_LABELS[call.status]}</StatusLabel> },
          { label: "Started", value: formatDateTime(call.startedAt) },
          { label: "Duration", value: formatDuration(call.durationMs) },
          { label: "Tool", value: call.toolName },
        ]}
      />
      <RecordLine
        items={[
          { label: "Principal", value: `${call.hrUser.displayName} (HR user)` },
          { label: "Request ID", value: call.requestId },
          { label: "Validation", value: VALIDATION_LABELS[call.validationStatus] },
          { label: "Error category", value: call.errorCategory ?? "—" },
        ]}
      />
      <ViewSwitch
        kind="mcp"
        id={call.mcpCallId}
        formatted={
          <div className="flex flex-col gap-3">
            {detail.redaction.note ? (
              <p className="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {detail.redaction.note}
              </p>
            ) : null}
            <McpBody detail={detail} />
          </div>
        }
      />
    </div>
  );
}
