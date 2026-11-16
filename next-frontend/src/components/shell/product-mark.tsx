import { cn } from "@/lib/utils";

// Type-only wordmark. No logo asset exists for ACME, so none is drawn.
export function ProductMark({ className }: { className?: string }) {
  return (
    <p className={cn("leading-tight", className)} translate="no">
      <span className="block text-[0.9375rem] font-bold tracking-[-0.01em]">ACME</span>
      <span className="block text-[0.8125rem] font-medium text-rail-muted">Compensation Manager</span>
    </p>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-md bg-surface px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      Skip to main content
    </a>
  );
}
