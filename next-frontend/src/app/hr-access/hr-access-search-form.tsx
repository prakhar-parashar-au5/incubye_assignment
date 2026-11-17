"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { HrAccessMobileFilters } from '@/app/hr-access/hr-access-mobile-filters';
import { defaultHrDirection, hrAccessFormQuery, hrAccessSearch, type HrAccessQuery } from '@/lib/hr-access';

// HR Access list search and filters (QA run 03, D3). With JavaScript, a submit navigates to a URL
// built from the current state plus the form's fields: each key once, blank fields dropped, page
// reset. Without JavaScript the browser submits the GET form; the parser treats blank values as
// "not set", so that path also works. Sort, order, and page size are carried only when they are
// not the defaults.

const inputClass = 'mt-1 block h-10 w-full rounded-md border border-input bg-surface px-3 font-normal';

export function HrAccessSearchForm({ query }: { query: HrAccessQuery }) {
  // The fields are uncontrolled, and a select does not follow a changed defaultValue. Keying by the
  // list state remounts the form after each navigation, so the hidden desktop fields on mobile
  // never submit a stale value over a filter chosen in the sheet.
  return <SearchForm key={hrAccessSearch(query)} query={query} />;
}

function SearchForm({ query }: { query: HrAccessQuery }) {
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(`/hr-access${hrAccessSearch(hrAccessFormQuery(query, new FormData(event.currentTarget)))}`);
  }

  const carrySort = query.sort && query.sort !== 'updatedAt';
  const carryDirection = query.direction && query.direction !== defaultHrDirection(query.sort);
  const carryPageSize = query.pageSize && query.pageSize !== 25;

  return (
    <form method="get" action="/hr-access" onSubmit={submit} role="search" aria-label="Search and filter HR users" className="mt-7 max-w-6xl border-y border-line py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
          Search by name or exact email
          <input name="q" defaultValue={query.q ?? ''} maxLength={100} autoComplete="off" className={inputClass} />
        </label>
        <HrAccessMobileFilters query={query} />
        <Button type="submit" variant="outline">Search</Button>
      </div>
      {carrySort ? <input type="hidden" name="sort" value={query.sort} /> : null}
      {carryDirection ? <input type="hidden" name="direction" value={query.direction} /> : null}
      {carryPageSize ? <input type="hidden" name="pageSize" value={query.pageSize} /> : null}
      {/* Desktop filters. On mobile they live in the filter sheet, which navigates on Apply. */}
      <fieldset className="mt-4 hidden grid-cols-1 gap-4 lg:grid lg:grid-cols-4">
        <legend className="sr-only">Filters</legend>
        <label className="space-y-1 text-sm font-medium">Role
          <NativeSelect wrapperClassName="mt-1" className="font-normal" name="role" defaultValue={query.role ?? ''}>
            <option value="">All roles</option><option value="ADMIN">Admin HR</option><option value="SCOPED">Scoped HR</option>
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm font-medium">Status
          <NativeSelect wrapperClassName="mt-1" className="font-normal" name="status" defaultValue={query.status ?? 'ACTIVE'}>
            <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">Active and inactive</option>
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm font-medium">Country scope
          <NativeSelect wrapperClassName="mt-1" className="font-normal" name="country" defaultValue={query.country ?? ''}>
            <option value="">All countries</option><option value="IN">India</option><option value="US">United States</option>
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm font-medium">Department scope
          <NativeSelect wrapperClassName="mt-1" className="font-normal" name="department" defaultValue={query.department ?? ''}>
            <option value="">All departments</option>
            {['Tech', 'HR', 'Finance', 'Operations', 'Support'].map((name) => <option key={name}>{name}</option>)}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline" className="w-fit">Apply filters</Button>
        <Link className="self-center text-sm font-medium text-primary underline underline-offset-4" href="/hr-access">Clear filters</Link>
      </fieldset>
    </form>
  );
}
