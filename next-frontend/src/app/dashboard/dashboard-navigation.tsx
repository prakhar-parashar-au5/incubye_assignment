"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState, useTransition, type ReactNode } from "react";

// Dashboard changes (filters, periods, breakdown tab, pages) are router navigations inside a
// transition: the current figures stay on screen, dimmed and marked busy, until the new server
// render arrives. A polite live region then says the dashboard was updated, so screen-reader
// users know the change landed even though focus stays on the control they used.

type DashboardNavigation = { pending: boolean; navigate: (href: string) => void };

const Context = createContext<DashboardNavigation | null>(null);

export function DashboardNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const navigated = useRef(false);
  const wasPending = useRef(false);

  const navigate = (href: string) => {
    navigated.current = true;
    setAnnouncement("");
    startTransition(() => router.push(href, { scroll: false }));
  };

  useEffect(() => {
    if (wasPending.current && !pending && navigated.current) {
      navigated.current = false;
      // Deferred so the cleared text and the new text are separate live-region updates.
      const timer = setTimeout(() => setAnnouncement("Dashboard updated."), 50);
      wasPending.current = pending;
      return () => clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <Context value={{ pending, navigate }}>
      <p role="status" aria-live="polite" className="sr-only" data-testid="dashboard-announcement">
        {pending ? "Updating dashboard…" : announcement}
      </p>
      {children}
    </Context>
  );
}

export function useDashboardNavigation(): DashboardNavigation {
  const value = use(Context);
  if (!value) throw new Error("useDashboardNavigation must be used inside DashboardNavigationProvider");
  return value;
}

/** The dashboard content, dimmed and marked busy while a change is loading. */
export function PendingRegion({ children }: { children: ReactNode }) {
  const { pending } = useDashboardNavigation();
  return (
    <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity duration-150" : "transition-opacity duration-150"}>
      {children}
    </div>
  );
}
