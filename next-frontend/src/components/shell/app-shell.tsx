import Link from "next/link";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";

import { ProductMark, SkipLink } from "@/components/shell/product-mark";
import { ScopeRecord } from "@/components/shell/scope-record";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ADMIN_QUEUE_HREF } from "@/lib/salary";
import { signOut } from "@/server/actions/auth";

// Application shell: a navy rail on desktop, a compact navy header on mobile. Dashboard,
// Employees, Salary requests, Assistant, and (Admin HR only) HR Access, AI monitoring, and Artifacts are built; the other sections are listed as plain
// text marked "Coming later", never as controls.

export type ShellIdentity = { name: string; role: string; scope: string; isAdmin: boolean };

export type ShellSection = "dashboard" | "employees" | "requests" | "assistant" | "hr-access" | "monitoring" | "artifacts";

// Admin HR opens the approval queue (pending, oldest first); Scoped HR opens their request list.
const sections = (isAdmin: boolean): { id: ShellSection; label: string; href: string }[] => [
  { id: "dashboard", label: "Dashboard", href: "/dashboard" },
  { id: "employees", label: "Employees", href: "/employees" },
  { id: "requests", label: "Salary requests", href: isAdmin ? ADMIN_QUEUE_HREF : "/salary-requests" },
  { id: "assistant", label: "Assistant", href: "/assistant" },
  // Presentation only: the backend answers 403 to anyone who is not current Admin HR.
  ...(isAdmin ? [{ id: "hr-access" as const, label: "HR Access", href: "/hr-access" }] : []),
  ...(isAdmin ? [{ id: "monitoring" as const, label: "AI monitoring", href: "/admin/ai-monitoring" }] : []),
  // Presentation only: every /artifacts route checks Admin HR on the server (src/server/artifacts.ts).
  ...(isAdmin ? [{ id: "artifacts" as const, label: "Artifacts", href: "/artifacts" }] : []),
];

function Navigation({ className, current, isAdmin }: { className?: string; current: ShellSection; isAdmin: boolean }) {
  return (
    <nav aria-label="Main" className={className}>
      <ul className="space-y-0.5 text-[0.875rem]">
        {sections(isAdmin).map((section) => (
          <li key={section.id}>
            <Link
              href={section.href}
              aria-current={section.id === current ? "page" : undefined}
              className={
                section.id === current
                  ? "flex items-center rounded-md bg-rail-active px-3 py-2 font-semibold text-rail-foreground"
                  : "flex items-center rounded-md px-3 py-2 text-rail-foreground hover:bg-rail-active/60"
              }
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SignOutForm({ className }: { className?: string }) {
  return (
    <form action={signOut} className={className}>
      <Button type="submit" variant="rail" className="w-full">
        Sign out
      </Button>
    </form>
  );
}

function Identity({ identity, headingLevel = "h2" }: { identity: ShellIdentity | null; headingLevel?: "h2" | "p" }) {
  if (!identity) return null;
  const Name = headingLevel;
  return (
    <section aria-label="Signed-in HR account" className="space-y-2">
      <Name className="text-[0.9375rem] font-semibold">{identity.name}</Name>
      <ScopeRecord role={identity.role} scope={identity.scope} tone="rail" />
    </section>
  );
}

export function AppShell({
  identity,
  children,
  current = "employees",
}: {
  identity: ShellIdentity | null;
  children: ReactNode;
  current?: ShellSection;
}) {
  return (
    <div data-app-root="" className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <SkipLink />

      {/* Desktop rail */}
      <aside
        data-surface="rail"
        className="sticky top-0 hidden h-dvh flex-col gap-8 overflow-y-auto bg-rail px-4 py-7 text-rail-foreground lg:flex"
      >
        <ProductMark className="px-2" />
        <Navigation className="flex-1" current={current} isAdmin={identity?.isAdmin ?? false} />
        <div className="space-y-4 px-2">
          <Identity identity={identity} />
          <SignOutForm />
        </div>
      </aside>

      {/* Mobile header */}
      <header data-surface="rail" className="relative bg-rail text-rail-foreground lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <ProductMark />
          <details className="group">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-rail-line px-3 text-sm font-medium hover:bg-rail-active [&::-webkit-details-marker]:hidden">
              <Menu aria-hidden="true" className="size-4" />
              Menu
            </summary>
            <div className="absolute inset-x-0 z-20 mt-3 space-y-6 border-t border-rail-line bg-rail px-4 pt-4 pb-6 shadow-[0_12px_24px_-12px_rgba(16,24,40,0.45)]">
              <Navigation current={current} isAdmin={identity?.isAdmin ?? false} />
              <SignOutForm />
            </div>
          </details>
        </div>
        {identity ? (
          <div className="border-t border-rail-line px-4 py-3">
            <Identity identity={identity} headingLevel="p" />
          </div>
        ) : null}
      </header>

      <main id="main" className="min-w-0 px-4 pt-8 pb-16 sm:px-8 lg:pt-10 xl:px-12">
        {children}
      </main>
    </div>
  );
}

export function AppShellSkeleton({ children }: { children: ReactNode; current?: ShellSection }) {
  const bar = "animate-none bg-rail-active";
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside data-surface="rail" className="hidden h-dvh flex-col gap-8 bg-rail px-4 py-7 text-rail-foreground lg:flex">
        <ProductMark className="px-2" />
        <div className="flex-1" />
        <div className="space-y-3 px-2">
          <Skeleton className={cn(bar, "h-4 w-32")} />
          <Skeleton className={cn(bar, "h-9 w-full")} />
        </div>
      </aside>
      <header data-surface="rail" className="flex items-center justify-between bg-rail px-4 py-3 text-rail-foreground lg:hidden">
        <ProductMark />
      </header>
      <main id="main" className="min-w-0 px-4 pt-8 pb-16 sm:px-8 lg:pt-10 xl:px-12">
        {children}
      </main>
    </div>
  );
}
