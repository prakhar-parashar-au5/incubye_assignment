"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { DEFAULT_PAGE_SIZE, directoryHref, withChanges, type DirectoryQuery } from "@/lib/directory-url";

import { useDirectoryNavigation } from "./directory-navigation";

export function PageSizeSelect({ query, choices }: { query: DirectoryQuery; choices: number[] }) {
  const { navigate } = useDirectoryNavigation();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="whitespace-nowrap text-muted-foreground">
        Rows
      </Label>
      <NativeSelect
        id={id}
        className="h-9 w-20"
        value={String(query.pageSize ?? DEFAULT_PAGE_SIZE)}
        onChange={(event) => navigate(directoryHref(withChanges(query, { pageSize: Number(event.target.value) })))}
      >
        {choices.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
