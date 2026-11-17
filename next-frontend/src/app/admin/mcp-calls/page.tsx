import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { ActiveFilters, FilterForm, InvalidFilters, Pagination, ResultsLine, ScrollTable, td, th, type FilterField } from "@/components/ai-monitoring/list-parts";
import { MonitoringHeading, StatusLabel } from "@/components/ai-monitoring/monitoring-ui";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ForbiddenState, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CALL_STATUS_LABELS,
  MCP_HREF,
  VALIDATION_LABELS,
  callTone,
  formatDuration,
  listHref,
  parseMcpQuery,
  type McpListItem,
  type McpQuery,
  type TraceOptions,
} from "@/lib/ai-monitoring";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

// MCP calls: their own audit trail. MCP calls do not use the language model, so there is no model,
// token, or review column, and no link to an AI trace. Rows carry no arguments or results.

export const metadata: Metadata = { title: "MCP calls", robots: { index: false, follow: false } };

const SUBTITLE = "Calls from MCP clients. They do not use the language model, so they have no model calls, tokens, or reviews.";

export default function McpListPage({ searchParams }: PageProps<"/admin/mcp-calls">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <MonitoringHeading view="mcp" title="MCP calls" subtitle={SUBTITLE} />
          <div className="mt-8 flex max-w-6xl flex-col gap-2" aria-busy="true">
            <p role="status" className="text-sm text-muted-foreground">
              Loading MCP calls…
            </p>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} aria-hidden="true" className="h-9 w-full animate-none bg-muted" />
            ))}
          </div>
        </AppShellSkeleton>
      }
    >
      <McpList searchParams={searchParams} />
    </Suspense>
  );
}

async function McpList({ searchParams }: { searchParams: PageProps<"/admin/mcp-calls">["searchParams"] }) {
  const [params, { session, token }] = await Promise.all([searchParams, loadSessionAndToken()]);
  const parsed = parseMcpQuery(params);
  const client = api();
  const [list, options] = await Promise.all([
    token && parsed.ok ? client.listAdminMcpToolCalls(token, parsed.query) : Promise.resolve(null),
    token ? client.getAdminAiTraceOptions(token) : Promise.resolve(null),
  ]);
  const user = requireUser(session);
  redirectIfUnauthenticated(list && !list.ok ? list.kind : undefined, options && !options.ok ? options.kind : undefined);
  const heading = <MonitoringHeading view="mcp" title="MCP calls" subtitle={SUBTITLE} />;
  if (!user) {
    return (
      <AppShell identity={null} current="monitoring">
        {heading}
        <ServiceUnavailable retryHref={MCP_HREF} />
      </AppShell>
    );
  }
  if ((list && !list.ok && list.kind === "FORBIDDEN") || (options && !options.ok && options.kind === "FORBIDDEN")) {
    return (
      <AppShell identity={identityOf(user)} current="monitoring">
        {heading}
        <ForbiddenState area="MCP calls" />
      </AppShell>
    );
  }
  const query: McpQuery = parsed.ok ? parsed.query : {};
  const opts = options?.ok ? options.data : null;
  let results: ReactNode;
  if (!parsed.ok || (list && !list.ok && list.kind === "VALIDATION_ERROR")) {
    results = <InvalidFilters clearHref={MCP_HREF} />;
  } else if (!list || !list.ok) {
    const retry = listHref(MCP_HREF, query, false);
    results = list?.kind === "INVALID_RESPONSE" ? <UnexpectedResponse retryHref={retry} /> : <ServiceUnavailable retryHref={retry} className="max-w-2xl" />;
  } else {
    const { calls, page } = list.data;
    const back = listHref(MCP_HREF, query, false);
    const filtered = Object.keys(query).some((key) => key !== "page" && key !== "pageSize");
    results = (
      <div className="flex flex-col gap-4">
        <ResultsLine noun="MCP call" totalRows={page.totalRows} page={page.number} totalPages={page.totalPages} />
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">{filtered ? "No MCP calls match these filters." : "No MCP calls have been recorded in the last 30 days."}</p>
        ) : (
          <>
            <McpTable calls={calls} back={back} />
            <McpItems calls={calls} back={back} />
          </>
        )}
        <Pagination base={MCP_HREF} query={query} page={page.number} totalPages={page.totalPages} />
      </div>
    );
  }
  const userName = (id: string) => opts?.hrUsers.find((u) => String(u.id) === id)?.displayName ?? `HR user ${id}`;
  return (
    <AppShell identity={identityOf(user)} current="monitoring">
      {heading}
      <div className="mt-6 flex max-w-6xl flex-col gap-6">
        <FilterForm action={MCP_HREF} fields={fields(query, opts)} pageSize={query.pageSize ?? 25} clearHref={MCP_HREF} />
        {parsed.ok ? (
          <ActiveFilters
            base={MCP_HREF}
            query={query}
            labels={{
              from: (v) => `From ${v}`,
              to: (v) => `To ${v}`,
              hrUserId: (v) => `Principal: ${userName(v)}`,
              tool: (v) => `Tool: ${v}`,
              status: (v) => `Status: ${CALL_STATUS_LABELS[v as keyof typeof CALL_STATUS_LABELS] ?? v}`,
            }}
          />
        ) : null}
        {results}
      </div>
    </AppShell>
  );
}

function fields(query: McpQuery, options: TraceOptions | null): FilterField[] {
  const tools = options?.toolNames ?? [];
  const toolChoices = (query.tool && !tools.includes(query.tool) ? [...tools, query.tool] : tools).map((value) => ({ value, label: value }));
  return [
    { kind: "date", name: "from", label: "From (UTC date)", value: query.from },
    { kind: "date", name: "to", label: "To (UTC date)", value: query.to },
    {
      kind: "select",
      name: "hrUserId",
      label: "Principal (HR user)",
      value: query.hrUserId ? String(query.hrUserId) : undefined,
      choices: options?.hrUsers.map((u) => ({ value: String(u.id), label: u.displayName })) ?? [],
      unavailable: !options,
    },
    { kind: "select", name: "tool", label: "Tool", value: query.tool, choices: toolChoices, unavailable: !options },
    {
      kind: "select",
      name: "status",
      label: "Execution",
      value: query.status,
      choices: (["SUCCEEDED", "REJECTED", "FAILED", "STARTED"] as const).map((s) => ({ value: s, label: CALL_STATUS_LABELS[s] })),
    },
  ];
}

function detailHref(call: McpListItem, back: string) {
  return `${MCP_HREF}/${call.mcpCallId}${back !== MCP_HREF ? `?back=${encodeURIComponent(back)}` : ""}`;
}
const rowName = (call: McpListItem) => `MCP call started ${formatDateTime(call.startedAt)}, ${call.toolName}, ${CALL_STATUS_LABELS[call.status]}`;

function McpTable({ calls, back }: { calls: McpListItem[]; back: string }) {
  return (
    <ScrollTable label="MCP calls table">
      <table className="w-full min-w-[56rem] border-collapse text-[0.8125rem]">
        <caption className="sr-only">MCP calls, newest first</caption>
        <thead>
          <tr>
            {["Started (UTC)", "Principal", "Tool", "Validation", "Execution", "Duration", "Error category"].map((label) => (
              <th key={label} scope="col" className={cn(th, label === "Duration" && "text-right")}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.mcpCallId}>
              <td className={cn(td, "whitespace-nowrap")}>
                <Link href={detailHref(call, back)} aria-label={rowName(call)} className="font-medium text-primary underline-offset-4 hover:underline">
                  {formatDateTime(call.startedAt)}
                </Link>
              </td>
              <td className={td}>{call.hrUser.displayName}</td>
              <td className={cn(td, "[overflow-wrap:anywhere]")}>{call.toolName}</td>
              <td className={td}>{VALIDATION_LABELS[call.validationStatus]}</td>
              <td className={td}>
                <StatusLabel tone={callTone(call.status)}>{CALL_STATUS_LABELS[call.status]}</StatusLabel>
              </td>
              <td className={cn(td, "text-right whitespace-nowrap tabular-nums")}>{formatDuration(call.durationMs)}</td>
              <td className={cn(td, "[overflow-wrap:anywhere]")}>{call.errorCategory ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function McpItems({ calls, back }: { calls: McpListItem[]; back: string }) {
  return (
    <ol aria-label="MCP calls, newest first" className="flex flex-col border-t border-line lg:hidden">
      {calls.map((call) => (
        <li key={call.mcpCallId} className="flex flex-col gap-1 border-b border-line py-3 text-[0.8125rem]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Link href={detailHref(call, back)} aria-label={rowName(call)} className="font-medium text-primary underline-offset-4 hover:underline">
              {formatDateTime(call.startedAt)}
            </Link>
            <StatusLabel tone={callTone(call.status)}>{CALL_STATUS_LABELS[call.status]}</StatusLabel>
          </div>
          <p className="[overflow-wrap:anywhere]">
            {call.toolName} · {call.hrUser.displayName}
          </p>
          <p className="text-muted-foreground">
            Validation: {VALIDATION_LABELS[call.validationStatus]} · {formatDuration(call.durationMs)}
            {call.errorCategory ? ` · ${call.errorCategory}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
