"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";

import { cn } from "@/lib/utils";

// "About USD comparison": a button that shows or hides the rate context inline. It is not a
// tooltip, so it works the same with a mouse, a keyboard (Enter or Space), touch, and a screen
// reader, which announces the expanded state and reads the panel as ordinary text.

export function UsdDisclosure({ children, label = "About USD comparison" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[0.8125rem] font-medium text-primary underline-offset-4 hover:underline"
      >
        <Info aria-hidden="true" className="size-3.5" />
        {label}
        <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} />
      </button>
      <div id={`${id}-panel`} hidden={!open} className="max-w-2xl rounded-md border border-[#c3d0ec] bg-accent px-3.5 py-3 text-[0.8125rem]">
        {children}
      </div>
    </div>
  );
}
