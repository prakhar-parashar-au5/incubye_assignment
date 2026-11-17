import Link from "next/link";
import type { ReactNode } from "react";

import { MCP_HREF, MONITORING_HREF, TRACES_HREF, type Tone } from "@/lib/ai-monitoring";
import { cn } from "@/lib/utils";

// Shared pieces of the Admin AI-monitoring pages: the view links (Overview, Traces, MCP calls),
// the page heading, the dot-plus-words status label, and the ruled record line (the product's
// access-record form, used for trace and call headers).

export type MonitoringView = "overview" | "traces" | "mcp";

const VIEWS: { id: MonitoringView; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: MONITORING_HREF },
  { id: "traces", label: "Traces", href: TRACES_HREF },
  { id: "mcp", label: "MCP calls", href: MCP_HREF },
];

export function MonitoringHeading({ view, title, subtitle }: { view: MonitoringView; title: string; subtitle: string }) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em] text-balance">{title}</h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{subtitle}</p>
      <nav aria-label="AI monitoring views" className="mt-5 border-b border-line">
        <ul className="-mb-px flex flex-wrap gap-x-1">
          {VIEWS.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={item.id === view ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium transition-[border-color,color] duration-150",
                  item.id === view ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-line hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

const DOT: Record<Tone, string> = {
  ok: "bg-state-current",
  error: "bg-destructive",
  warn: "bg-state-upcoming",
  muted: "bg-state-historical",
};

/** A 6px dot in the state colour, always beside its words. The dot is hidden from assistive tech. */
export function StatusLabel({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline whitespace-nowrap", className)}>
      <span aria-hidden="true" className={cn("mr-1.5 inline-block size-1.5 shrink-0 translate-y-[-1px] rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

/** One ruled record line: label over value, in fixed columns that wrap on narrow screens. */
export function RecordLine({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 text-[0.8125rem] leading-snug sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="font-medium break-words [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-[0.9375rem] font-semibold">
      {children}
    </h2>
  );
}
