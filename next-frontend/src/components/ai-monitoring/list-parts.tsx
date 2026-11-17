import Link from "next/link";
import { CircleAlert, X } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PAGE_SIZES, formatNumber, listHref } from "@/lib/ai-monitoring";

// Filter form, active-filter chips, results line, pagination, and invalid-filter state shared by the
// trace and MCP lists. The form is a plain GET form: filters live in the URL, work without
// JavaScript, and the browser moves to #results after applying, so keyboard focus starts at the
// results line.

export type FilterField =
  | { kind: "date"; name: string; label: string; value: string | undefined }
  | { kind: "select"; name: string; label: string; value: string | undefined; choices: { value: string; label: string }[]; unavailable?: boolean };

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-base text-foreground transition-[border-color] duration-150 focus-visible:border-ring md:text-sm";

export function FilterForm({ action, fields, pageSize, clearHref }: { action: string; fields: FilterField[]; pageSize: number; clearHref: string }) {
  const anyUnavailable = fields.some((field) => field.kind === "select" && field.unavailable);
  return (
    <form method="get" action={`${action}#results`} aria-label="Filters" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => {
          const id = `filter-${field.name}`;
          return (
            <div key={field.name} className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={id}>{field.label}</Label>
              {field.kind === "date" ? (
                <input id={id} name={field.name} type="date" defaultValue={field.value ?? ""} className={inputClass} />
              ) : (
                <NativeSelect id={id} name={field.name} defaultValue={field.value ?? ""}>
                  <option value="">All</option>
                  {field.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </div>
          );
        })}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="filter-pageSize">Per page</Label>
          <NativeSelect id="filter-pageSize" name="pageSize" defaultValue={String(pageSize)}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {anyUnavailable ? <p className="text-[0.8125rem] text-muted-foreground">Some filter choices could not be loaded. The list still works; reload to try again.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonVariants({ className: "h-10 sm:h-9" })}>
          Apply filters
        </button>
        <Link href={clearHref} className="text-sm font-medium text-primary underline underline-offset-4">
          Clear all
        </Link>
      </div>
    </form>
  );
}

/** Each active filter as a removable link; removing one goes back to page 1. */
export function ActiveFilters({ base, query, labels }: { base: string; query: Record<string, string | number | undefined>; labels: Record<string, (value: string) => string> }) {
  const active = Object.entries(query).filter(([key, value]) => value !== undefined && value !== "" && key in labels);
  if (active.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap gap-2">
      {active.map(([key, value]) => {
        const rest = { ...query, [key]: undefined, page: undefined };
        const text = labels[key](String(value));
        return (
          <li key={key}>
            <Link
              href={listHref(base, rest)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-input bg-surface px-2.5 text-[0.8125rem] hover:bg-[#faf9f6]"
            >
              {text}
              <X aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Remove filter</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ResultsLine({ noun, totalRows, page, totalPages }: { noun: string; totalRows: number; page: number; totalPages: number }) {
  return (
    <h2 id="results" tabIndex={-1} className="scroll-mt-4 text-[0.9375rem] font-semibold outline-none focus-visible:outline-2">
      {formatNumber(totalRows)} {totalRows === 1 ? noun : `${noun}s`}
      {totalPages > 1 ? <span className="font-normal text-muted-foreground"> · page {formatNumber(page)} of {formatNumber(totalPages)}</span> : null}
    </h2>
  );
}

export function Pagination({ base, query, page, totalPages }: { base: string; query: Record<string, string | number | undefined>; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const link = (n: number, label: string) => (
    <Link href={listHref(base, { ...query, page: n })} className="inline-flex min-h-10 items-center font-medium text-primary underline underline-offset-4">
      {label}
    </Link>
  );
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm">
      {page > 1 ? link(page - 1, "Newer") : <span />}
      <span className="text-muted-foreground">
        Page {formatNumber(page)} of {formatNumber(totalPages)}
      </span>
      {page < totalPages ? link(page + 1, "Older") : <span />}
    </nav>
  );
}

export function InvalidFilters({ clearHref }: { clearHref: string }) {
  return (
    <Alert variant="destructive" className="max-w-2xl" id="results" tabIndex={-1}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle className="text-[#7d1a14]">These filters could not be applied</AlertTitle>
      <AlertDescription className="text-[#7d1a14]">
        <p>Check the dates (the end cannot be before the start) and the page size (at most 100). No results are shown.</p>
        <p>
          <Link href={clearHref} className="font-medium">
            Clear filters
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hidden overflow-x-auto lg:block" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

export const th = "border-b border-line px-2.5 py-2 text-left text-[0.75rem] font-semibold whitespace-nowrap text-muted-foreground";
export const td = "border-b border-line px-2.5 py-2.5 align-top";
