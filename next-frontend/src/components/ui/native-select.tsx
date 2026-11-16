import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// A native <select> styled to match Input. Native controls keep platform keyboard behaviour and
// the mobile pickers people already know.
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <span className="relative inline-flex w-full">
      <select
        className={cn(
          "h-10 w-full min-w-0 appearance-none rounded-md border border-input bg-surface py-1 pr-9 pl-3 text-base text-foreground transition-[border-color] duration-150 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        {...props}
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
