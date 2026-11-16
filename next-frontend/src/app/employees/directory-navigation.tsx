"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useTransition, type ReactNode } from "react";

// Directory changes are router navigations inside a transition: the current results stay on
// screen (dimmed, marked busy) until the new server render arrives, and the search field keeps
// whatever the person typed.

type DirectoryNavigation = { pending: boolean; navigate: (href: string) => void };

const Context = createContext<DirectoryNavigation | null>(null);

export function DirectoryNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  return <Context value={{ pending, navigate }}>{children}</Context>;
}

export function useDirectoryNavigation(): DirectoryNavigation {
  const value = use(Context);
  if (!value) throw new Error("useDirectoryNavigation must be used inside DirectoryNavigationProvider");
  return value;
}

export function PendingRegion({ children }: { children: ReactNode }) {
  const { pending } = useDirectoryNavigation();
  return (
    <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity duration-150" : "transition-opacity duration-150"}>
      <p role="status" className="sr-only">
        {pending ? "Loading employees…" : ""}
      </p>
      {children}
    </div>
  );
}
