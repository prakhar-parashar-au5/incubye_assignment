"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useDashboardNavigation } from "./dashboard-navigation";

// WAI-ARIA tabs with manual activation: Left/Right/Home/End move focus between tabs, and
// Enter, Space, or a click selects one. Manual activation suits panels that load from the
// server, because arrowing past a tab does not start a request for it. Each tab is also a
// real link, so the breakdown works without JavaScript and the selection lives in the URL.

export type BreakdownTab = { key: string; label: string; href: string };

export function BreakdownTabs({ tabs, selected, children }: { tabs: BreakdownTab[]; selected: string; children: ReactNode }) {
  const { navigate, pending } = useDashboardNavigation();
  const id = useId();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const tabId = (key: string) => `${id}-tab-${key}`;
  const panelId = `${id}-panel`;

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next !== null) {
      event.preventDefault();
      refs.current[next]?.focus();
      return;
    }
    if (event.key === " ") {
      // Space activates a tab; a link would otherwise scroll the page.
      event.preventDefault();
      navigate(tabs[index].href);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Breakdown" className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((tab, index) => {
          const active = tab.key === selected;
          return (
            <a
              key={tab.key}
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={tabId(tab.key)}
              href={tab.href}
              role="tab"
              aria-selected={active}
              aria-controls={active ? panelId : undefined}
              // Roving tabindex: only the selected tab is in the Tab sequence.
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (!active) navigate(tab.href);
              }}
              className={cn(
                "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-[color,border-color] duration-150",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </a>
          );
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(selected)} aria-busy={pending} tabIndex={0} className="min-w-0 rounded-sm">
        {children}
      </div>
    </div>
  );
}
