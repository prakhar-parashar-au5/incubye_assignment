"use client";

import { useId, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";

import { McpBody } from "@/components/ai-monitoring/mcp-body";
import { TurnLedger } from "@/components/ai-monitoring/turn-ledger";
import { Button } from "@/components/ui/button";
import { RAW_WARNING, type McpDetail, type TraceDetail } from "@/lib/ai-monitoring";
import { loadRawMcpCall, loadRawTrace, type AdminErrorCode } from "@/server/actions/ai-monitoring";

// Formatted | Raw JSON. The formatted view is server-rendered and passed in. The raw view is fetched
// only after the synthetic-data warning is accepted, and only into this component's memory: it is
// never put in the URL, browser storage, the router cache, or a log, and it is cleared when the
// user goes back to Formatted or leaves the page. The warning is shown again on every visit.
// WAI-ARIA tabs with manual activation: arrow keys move focus, Enter or Space selects.

type Raw =
  | { state: "warning" }
  | { state: "loading" }
  | { state: "shown"; trace?: TraceDetail; mcp?: McpDetail }
  | { state: "error"; error: AdminErrorCode };

const RAW_ERROR: Partial<Record<AdminErrorCode, string>> = {
  FORBIDDEN: "Your HR role cannot view raw trace data.",
  NOT_FOUND: "This record no longer exists. It may have been deleted.",
  SESSION_EXPIRED: "Your session has ended. Sign in again.",
};

export function ViewSwitch({ kind, id, formatted }: { kind: "trace" | "mcp"; id: string; formatted: ReactNode }) {
  const [tab, setTab] = useState<"formatted" | "raw">("formatted");
  const [raw, setRaw] = useState<Raw>({ state: "warning" });
  const [, startTransition] = useTransition();
  const generation = useRef(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const warningRef = useRef<HTMLHeadingElement>(null);
  const rawHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const noun = kind === "trace" ? "trace" : "MCP call";

  useLayoutEffect(() => {
    return () => {
      generation.current += 1;
      setRaw({ state: "warning" });
      setTab("formatted");
    };
  }, []);

  function select(next: "formatted" | "raw") {
    generation.current += 1;
    setTab(next);
    setRaw({ state: "warning" });
    if (next === "raw") requestAnimationFrame(() => warningRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + 2) % 2;
    tabs.current[next]?.focus();
  }

  function showRaw() {
    const started = ++generation.current;
    setRaw({ state: "loading" });
    startTransition(async () => {
      let next: Raw;
      try {
        const result = kind === "trace" ? await loadRawTrace(id) : await loadRawMcpCall(id);
        if (!result.ok) next = { state: "error", error: result.error };
        else next = kind === "trace" ? { state: "shown", trace: result.detail as TraceDetail } : { state: "shown", mcp: result.detail as McpDetail };
      } catch {
        next = { state: "error", error: "UNAVAILABLE" };
      }
      if (generation.current !== started) return;
      setRaw(next);
      requestAnimationFrame(() => (next.state === "shown" ? rawHeadingRef.current : errorRef.current)?.focus());
    });
  }

  function backToFormatted() {
    select("formatted");
    requestAnimationFrame(() => tabs.current[0]?.focus());
  }

  const tabClass = (active: boolean) =>
    `inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

  const shownWarning = raw.state === "shown" ? (raw.trace?.warning ?? raw.mcp?.warning ?? RAW_WARNING) : RAW_WARNING;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="tablist" aria-label="Trace data view" className="flex border-b border-line">
        {(["formatted", "raw"] as const).map((value, index) => (
          <button
            key={value}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${base}-${value}-tab`}
            aria-selected={tab === value}
            aria-controls={`${base}-${value}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => select(value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={tabClass(tab === value)}
          >
            {value === "formatted" ? "Formatted" : "Raw JSON"}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${base}-formatted-panel`} aria-labelledby={`${base}-formatted-tab`} hidden={tab !== "formatted"} className="min-w-0">
        {formatted}
      </div>

      <div role="tabpanel" id={`${base}-raw-panel`} aria-labelledby={`${base}-raw-tab`} hidden={tab !== "raw"} className="min-w-0">
        {tab === "raw" && (raw.state === "warning" || raw.state === "loading") ? (
          <section aria-labelledby={`${base}-warning`} className="flex max-w-2xl items-start gap-2.5 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3.5 py-3 text-sm">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
            <div className="flex flex-col gap-2">
              <h2 id={`${base}-warning`} ref={warningRef} tabIndex={-1} className="font-semibold outline-none">
                Raw {noun} data
              </h2>
              <p>{RAW_WARNING}</p>
              <p className="text-muted-foreground">It is shown only on this page, only until you leave it, and is not saved in your browser.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={showRaw} disabled={raw.state === "loading"}>
                  {raw.state === "loading" ? "Loading raw data…" : `Show raw ${noun} data`}
                </Button>
                <Button type="button" variant="outline" onClick={backToFormatted}>
                  Back to formatted
                </Button>
              </div>
            </div>
          </section>
        ) : null}
        {tab === "raw" && raw.state === "error" ? (
          <div ref={errorRef} tabIndex={-1} role="alert" className="flex max-w-2xl items-start gap-2.5 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14] outline-none">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-2">
              <p className="font-medium">Raw {noun} data could not be displayed.</p>
              <p>{RAW_ERROR[raw.error] ?? "The formatted view is still available."}</p>
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={backToFormatted}>
                Back to formatted
              </Button>
            </div>
          </div>
        ) : null}
        {tab === "raw" && raw.state === "shown" ? (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 ref={rawHeadingRef} tabIndex={-1} className="text-[0.9375rem] font-semibold outline-none">
                Raw {noun} data
              </h2>
              <p className="text-[0.8125rem] text-state-upcoming">{shownWarning}</p>
            </div>
            {raw.trace ? <TurnLedger detail={raw.trace} mode="raw" /> : null}
            {raw.mcp ? <McpBody detail={raw.mcp} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
