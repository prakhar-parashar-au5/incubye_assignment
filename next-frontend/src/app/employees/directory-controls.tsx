"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  FILTER_KEYS,
  clearFilters,
  directoryHref,
  directorySearch,
  withChanges,
  type DirectoryQuery,
  type FilterKey,
  type SortField,
} from "@/lib/directory-url";
import { FILTER_LABELS, type FilterChoices } from "@/lib/directory-choices";
import { SORT_LABELS } from "@/lib/format";

import { useDirectoryNavigation } from "./directory-navigation";

type Props = {
  query: DirectoryQuery;
  /** Only values the permission-filtered options endpoint returned. */
  choices: FilterChoices;
  sortFields: SortField[];
};


/** Hidden fields that carry the rest of the state when the browser submits a form without JS. */
function HiddenState({ query, omit }: { query: DirectoryQuery; omit: string[] }) {
  const params = new URLSearchParams(directorySearch(query));
  return (
    <>
      {[...params.entries()]
        .filter(([key]) => !omit.includes(key) && key !== "page")
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
    </>
  );
}

function SearchForm({ query }: { query: DirectoryQuery }) {
  const { navigate } = useDirectoryNavigation();
  const id = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "");
    navigate(directoryHref(withChanges(query, { q: q.trim() || undefined })));
  }

  return (
    <form role="search" method="get" action="/employees" onSubmit={submit} className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-q`}>Search by name, employee ID, or exact email</Label>
      <div className="flex gap-2">
        <Input
          key={query.q ?? ""}
          id={`${id}-q`}
          name="q"
          type="search"
          defaultValue={query.q ?? ""}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Sneha, ACME00042, or name@acme.com…"
          className="max-w-xl"
        />
        <HiddenState query={query} omit={["q"]} />
        <Button type="submit" variant="outline" className="h-10">
          <Search aria-hidden="true" />
          Search
        </Button>
      </div>
    </form>
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
  onChange?: (value: string) => void;
  id: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{FILTER_LABELS[name]}</Label>
      <NativeSelect
        id={id}
        name={name}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
      >
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

function DesktopFilters({ query, choices }: { query: DirectoryQuery; choices: FilterChoices }) {
  const { navigate, pending } = useDirectoryNavigation();
  const id = useId();
  return (
    <form method="get" action="/employees" className="hidden flex-wrap items-end gap-3 lg:flex" aria-label="Filters">
      <HiddenState query={query} omit={[...FILTER_KEYS]} />
      {FILTER_KEYS.map((key) => (
        <div key={key} className="w-44">
          <FilterSelect
            id={`${id}-${key}`}
            name={key}
            value={query[key]}
            choices={choices[key]}
            onChange={(value) => navigate(directoryHref(withChanges(query, { [key]: value || undefined })))}
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
  );
}

type Draft = Pick<DirectoryQuery, FilterKey | "sort" | "direction">;

function MobileFilters({ query, choices, sortFields }: Props) {
  const { navigate } = useDirectoryNavigation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const id = useId();
  const active = FILTER_KEYS.filter((key) => query[key]).length;

  // While the sheet is open the page behind it is inert, so no Tab sequence, however fast, can
  // land on a control behind the scrim. The dialog itself is portalled outside the app root.
  useEffect(() => {
    const root = document.querySelector("[data-app-root]");
    if (!open || !root) return;
    root.setAttribute("inert", "");
    return () => root.removeAttribute("inert");
  }, [open]);

  function openChange(next: boolean) {
    if (next) setDraft({ department: query.department, country: query.country, currency: query.currency, level: query.level, status: query.status, sort: query.sort, direction: query.direction });
    setOpen(next);
  }

  function apply() {
    const changes: Partial<DirectoryQuery> = {};
    for (const key of FILTER_KEYS) changes[key] = (draft[key] || undefined) as never;
    changes.sort = draft.sort;
    changes.direction = draft.direction;
    navigate(directoryHref(withChanges(query, changes)));
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={openChange}>
      <SheetTrigger render={<Button type="button" variant="outline" className="h-10 lg:hidden" />}>
        <SlidersHorizontal aria-hidden="true" />
        {active > 0 ? `Filters and sort (${active} active)` : "Filters and sort"}
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-sm overflow-y-auto">
        <SheetHeader className="border-b border-line px-5 py-4">
          <SheetTitle className="text-[1.0625rem] font-semibold">Filters and sort</SheetTitle>
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-sort`}>Sort by</Label>
            <NativeSelect
              id={`${id}-sort`}
              value={draft.sort ?? "name"}
              onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value as SortField }))}
            >
              {sortFields.map((field) => (
                <option key={field} value={field}>
                  {SORT_LABELS[field]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-direction`}>Order</Label>
            <NativeSelect
              id={`${id}-direction`}
              value={draft.direction ?? "asc"}
              onChange={(event) => setDraft((current) => ({ ...current, direction: event.target.value as "asc" | "desc" }))}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </NativeSelect>
          </div>
        </div>
        <SheetFooter className="border-t border-line px-5 py-4">
          <Button type="button" size="lg" onClick={apply}>
            Apply
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              navigate(directoryHref(clearFilters(query)));
              setOpen(false);
            }}
          >
            Clear all filters
          </Button>
          <SheetClose render={<Button type="button" variant="ghost" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function DirectoryControls(props: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <SearchForm query={props.query} />
        </div>
        <MobileFilters {...props} />
      </div>
      <DesktopFilters query={props.query} choices={props.choices} />
    </div>
  );
}
