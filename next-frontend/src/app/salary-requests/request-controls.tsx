"use client";

import { useId, type FormEvent } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { STATUS_LABELS, requestListHref, type RequestListQuery, type RequestStatus } from "@/lib/salary";

import { useDirectoryNavigation } from "../employees/directory-navigation";

const STATUSES: RequestStatus[] = ["PENDING", "APPROVED", "CANCELLED", "STALE"];

/** Search, status, department (Admin only), and order for the request list; all in the URL. */
export function RequestControls({ query, departments }: { query: RequestListQuery; departments: string[] | null }) {
  const { navigate, pending } = useDirectoryNavigation();
  const id = useId();
  const go = (changes: Partial<RequestListQuery>) => navigate(requestListHref({ ...query, ...changes, page: undefined }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    go({ q: q || undefined });
  }

  return (
    <div className="flex flex-col gap-3">
      <form role="search" method="get" action="/salary-requests" onSubmit={submit} className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-q`} className="leading-snug">Search by employee name, employee ID, or exact email</Label>
        <div className="flex gap-2">
          <Input key={query.q ?? ""} id={`${id}-q`} name="q" type="search" defaultValue={query.q ?? ""} maxLength={100} autoComplete="off" spellCheck={false} className="max-w-xl" />
          {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
          {query.department ? <input type="hidden" name="department" value={query.department} /> : null}
          {query.direction ? <input type="hidden" name="direction" value={query.direction} /> : null}
          <Button type="submit" variant="outline" className="h-10">
            <Search aria-hidden="true" />
            Search
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-48 flex-col gap-1.5">
          <Label htmlFor={`${id}-status`}>Status</Label>
          <NativeSelect id={`${id}-status`} value={query.status ?? ""} onChange={(event) => go({ status: (event.target.value || undefined) as RequestStatus | undefined })}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {departments ? (
          <div className="flex w-48 flex-col gap-1.5">
            <Label htmlFor={`${id}-department`}>Department</Label>
            <NativeSelect
              id={`${id}-department`}
              value={query.department ?? ""}
              onChange={(event) => go({ department: (event.target.value || undefined) as RequestListQuery["department"] })}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="flex w-48 flex-col gap-1.5">
          <Label htmlFor={`${id}-direction`}>Order</Label>
          <NativeSelect id={`${id}-direction`} value={query.direction ?? "desc"} onChange={(event) => go({ direction: event.target.value as "asc" | "desc" })}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </NativeSelect>
        </div>
        <p aria-hidden="true" className="h-10 pb-2.5 text-[0.8125rem] text-muted-foreground">
          {pending ? "Updating…" : ""}
        </p>
      </div>
    </div>
  );
}
