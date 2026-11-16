"use client";

import { useEffect, useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  NO_ADJUSTMENT_MONTHS,
  RECENT_DAYS,
  clearDashboardFilters,
  dashboardHref,
  dashboardSearch,
  isOneOf,
  withDashboardChanges,
  type DashboardQuery,
} from "@/lib/dashboard-url";
import { FILTER_LABELS, type FilterChoices } from "@/lib/directory-choices";
import { FILTER_KEYS, type FilterKey } from "@/lib/directory-url";

import { useDashboardNavigation } from "./dashboard-navigation";

// Global dashboard filters. Choices are only the values the permission-filtered options
// endpoint returned for this HR user. Desktop applies on change, as the directory does; mobile
// collects choices in a sheet and applies them together.

/** Hidden fields that carry the rest of the state when a form is submitted without JS. */
function HiddenState({ query, omit }: { query: DashboardQuery; omit: string[] }) {
  const params = new URLSearchParams(dashboardSearch(query));
  return (
    <>
      {[...params.entries()]
        .filter(([key]) => !omit.includes(key) && key !== "noAdjustmentPage")
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
    </>
  );
}

function FilterSelect({
  name,
  value,
  choices,
  onChange,
  id,
}: {
  name: FilterKey;
  value: string | undefined;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  id: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{FILTER_LABELS[name]}</Label>
      <NativeSelect id={id} name={name} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function DashboardFilters({ query, choices }: { query: DashboardQuery; choices: FilterChoices }) {
  const { navigate, pending } = useDashboardNavigation();
  const id = useId();
  return (
    <>
      <form method="get" action="/dashboard" className="hidden flex-wrap items-end gap-3 lg:flex" aria-label="Dashboard filters">
        <HiddenState query={query} omit={[...FILTER_KEYS]} />
        {FILTER_KEYS.map((key) => (
          <div key={key} className="w-44">
            <FilterSelect
              id={`${id}-${key}`}
              name={key}
              value={query[key]}
              choices={choices[key]}
              onChange={(value) => navigate(dashboardHref(withDashboardChanges(query, { [key]: value || undefined })))}
            />
          </div>
        ))}
        <noscript>
          <Button type="submit" variant="outline" className="h-10">
            Apply filters
          </Button>
        </noscript>
        <p aria-hidden="true" className="h-10 self-end pb-2.5 text-[0.8125rem] text-muted-foreground">
          {pending ? "Updating…" : ""}
        </p>
      </form>
      <MobileFilters query={query} choices={choices} />
    </>
  );
}

type Draft = Pick<DashboardQuery, FilterKey>;

function MobileFilters({ query, choices }: { query: DashboardQuery; choices: FilterChoices }) {
  const { navigate } = useDashboardNavigation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const id = useId();
  const active = FILTER_KEYS.filter((key) => query[key]).length;

  // While the sheet is open the page behind it is inert, as on the directory.
  useEffect(() => {
    const root = document.querySelector("[data-app-root]");
    if (!open || !root) return;
    root.setAttribute("inert", "");
    return () => root.removeAttribute("inert");
  }, [open]);

  function openChange(next: boolean) {
    if (next) setDraft({ department: query.department, country: query.country, currency: query.currency, level: query.level, status: query.status });
    setOpen(next);
  }

  function apply() {
    navigate(
      dashboardHref(
        withDashboardChanges(query, {
          department: draft.department || undefined,
          country: draft.country || undefined,
          currency: draft.currency || undefined,
          level: draft.level || undefined,
          status: draft.status || undefined,
        }),
      ),
    );
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={openChange}>
      <SheetTrigger render={<Button type="button" variant="outline" className="h-10 w-fit lg:hidden" />}>
        <SlidersHorizontal aria-hidden="true" />
        {active > 0 ? `Filters (${active} active)` : "Filters"}
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-sm overflow-y-auto">
        <SheetHeader className="border-b border-line px-5 py-4">
          <SheetTitle className="text-[1.0625rem] font-semibold">Dashboard filters</SheetTitle>
          <SheetDescription>Only values in your access are listed.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-5">
          {FILTER_KEYS.map((key) => (
            <FilterSelect
              key={key}
              id={`${id}-${key}`}
              name={key}
              value={draft[key]}
              choices={choices[key]}
              onChange={(value) => setDraft((current) => ({ ...current, [key]: value || undefined }))}
            />
          ))}
        </div>
        <SheetFooter className="border-t border-line px-5 py-4">
          <Button type="button" size="lg" onClick={apply}>
            Apply
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              navigate(dashboardHref(clearDashboardFilters(query)));
              setOpen(false);
            }}
          >
            Clear filters
          </Button>
          <SheetClose render={<Button type="button" variant="ghost" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** "Recorded in the last 7, 30, or 90 days", as native radio buttons. */
export function RecentPeriodControl({ query }: { query: DashboardQuery }) {
  const { navigate } = useDashboardNavigation();
  const id = useId();
  const current = query.recentDays ?? "30";
  return (
    <form method="get" action="/dashboard" aria-labelledby={`${id}-legend`}>
      <HiddenState query={query} omit={["recentDays"]} />
      <fieldset className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <legend id={`${id}-legend`} className="mr-2 float-left pt-1.5 text-[0.8125rem] text-muted-foreground">
          Recorded in the last
        </legend>
        {RECENT_DAYS.map((days) => (
          <label
            key={days}
            className="relative inline-flex h-8 cursor-pointer items-center rounded-md border border-line bg-surface px-3 text-[0.8125rem] font-medium has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
          >
            <input
              type="radio"
              name="recentDays"
              value={days}
              checked={current === days}
              onChange={() => navigate(dashboardHref(withDashboardChanges(query, { recentDays: days })))}
              className="sr-only"
            />
            {days} days
          </label>
        ))}
        <noscript>
          <Button type="submit" variant="outline" size="sm">
            Show
          </Button>
        </noscript>
      </fieldset>
    </form>
  );
}

/** "No recorded adjustment in the last 3, 6, 12, or 24 months". */
export function NoAdjustmentPeriodControl({ query }: { query: DashboardQuery }) {
  const { navigate } = useDashboardNavigation();
  const id = useId();
  return (
    <form method="get" action="/dashboard" className="flex flex-wrap items-end gap-2">
      <HiddenState query={query} omit={["noAdjustmentMonths"]} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-months`} className="text-[0.8125rem] font-normal text-muted-foreground">
          No recorded adjustment in the last
        </Label>
        <NativeSelect
          id={`${id}-months`}
          name="noAdjustmentMonths"
          value={query.noAdjustmentMonths ?? "12"}
          wrapperClassName="w-40"
          onChange={(event) => {
            const value = event.target.value;
            if (isOneOf(NO_ADJUSTMENT_MONTHS, value)) navigate(dashboardHref(withDashboardChanges(query, { noAdjustmentMonths: value })));
          }}
        >
          {NO_ADJUSTMENT_MONTHS.map((months) => (
            <option key={months} value={months}>
              {months} months
            </option>
          ))}
        </NativeSelect>
      </div>
      <noscript>
        <Button type="submit" variant="outline" className="h-10">
          Show
        </Button>
      </noscript>
    </form>
  );
}
