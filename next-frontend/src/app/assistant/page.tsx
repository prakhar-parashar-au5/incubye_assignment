import type { Metadata } from "next";
import { Suspense } from "react";
import { FlaskConical } from "lucide-react";

import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ServiceUnavailable } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import { scopeSummary } from "@/lib/hr-scope";
import { identityOf, loadSessionAndToken, requireUser } from "@/server/protected";

import { AssistantChat } from "./assistant-chat";

export const metadata: Metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <Heading />
          <div className="mt-6 flex max-w-3xl flex-col gap-3" aria-busy="true">
            <p role="status" className="sr-only">
              Loading assistant…
            </p>
            <Skeleton className="h-16 w-full animate-none bg-muted" />
            <Skeleton className="h-24 w-full animate-none bg-muted" />
          </div>
        </AppShellSkeleton>
      }
    >
      <Assistant />
    </Suspense>
  );
}

async function Assistant() {
  const { session } = await loadSessionAndToken();
  const user = requireUser(session);
  if (!user) {
    return (
      <AppShell identity={null} current="assistant">
        <Heading />
        <ServiceUnavailable retryHref="/assistant" />
      </AppShell>
    );
  }
  const scope = scopeSummary(user.role, user.countries, user.departments);
  return (
    <AppShell identity={identityOf(user)} current="assistant">
      <Heading />
      <section
        aria-labelledby="synthetic-notice-heading"
        className="mt-5 flex max-w-3xl items-start gap-2.5 rounded-md border border-[#c3d0ec] bg-accent px-3.5 py-3 text-sm"
      >
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <h2 id="synthetic-notice-heading" className="font-semibold">
            Synthetic data assistant
          </h2>
          <p className="mt-0.5">
            Every employee and figure here is synthetic demo data. The assistant is read-only and answers within your access ({scope}). Its
            text is written by a language model; the figures in its cards come from the directory.
          </p>
        </div>
      </section>
      <div className="mt-8">
        <AssistantChat />
      </div>
    </AppShell>
  );
}

function Heading() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Compensation assistant</h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">Ask questions about the employees and compensation you can access</p>
    </div>
  );
}
