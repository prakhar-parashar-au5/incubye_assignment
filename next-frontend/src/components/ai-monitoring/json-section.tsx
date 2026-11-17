"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatBytes, jsonText, startsOpen } from "@/lib/ai-monitoring";

// One stored JSON value. Large values start collapsed. When open, the JSON is shown as one block of
// text inside its own scroll region (never as HTML and never as one DOM node per key), so a 256 KB
// result stays responsive and the page never scrolls sideways. Copy happens only on the button.

export function JsonSection({ label, value, collapsed = false }: { label: string; value: unknown; collapsed?: boolean }) {
  const { text, bytes, lines } = useMemo(() => jsonText(value), [value]);
  const [open, setOpen] = useState(() => !collapsed && startsOpen({ bytes, lines }));
  const [copy, setCopy] = useState<"" | "Copied" | "Copy failed">("");

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("Copied");
    } catch {
      setCopy("Copy failed");
    }
  }

  return (
    <details
      className="group min-w-0 rounded-md border border-line bg-surface"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-10 cursor-pointer items-center gap-2 px-3 py-2 text-[0.8125rem] font-medium [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-muted-foreground transition-transform duration-150 group-open:rotate-90">
          ›
        </span>
        <span className="min-w-0 break-words">{label}</span>
        <span className="ml-auto shrink-0 text-[0.75rem] font-normal text-muted-foreground tabular-nums">
          {formatBytes(bytes)} · {lines.toLocaleString("en-US")} {lines === 1 ? "line" : "lines"}
        </span>
      </summary>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-line px-3 pt-2 pb-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={copyText}>
              Copy JSON<span className="sr-only">: {label}</span>
            </Button>
            <span role="status" className="text-[0.75rem] text-muted-foreground">
              {copy}
            </span>
          </div>
          <div tabIndex={0} role="region" aria-label={`${label} JSON`} className="max-h-[32rem] overflow-auto rounded-sm bg-[#faf9f6] p-2">
            <pre className="font-mono text-[0.75rem] leading-relaxed">
              <code>{text}</code>
            </pre>
          </div>
        </div>
      ) : null}
    </details>
  );
}
