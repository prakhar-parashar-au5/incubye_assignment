import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Info } from "lucide-react";

import { ProductMark, SkipLink } from "@/components/shell/product-mark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { readDemoPassword } from "@/server/config";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  "session-expired": "Your session has ended. Sign in again to continue.",
  "signed-out": "You have signed out.",
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <SkipLink />
      <header
        data-surface="rail"
        className="flex items-center justify-between gap-4 bg-rail px-4 py-3 text-rail-foreground lg:min-h-dvh lg:flex-col lg:items-stretch lg:justify-between lg:px-6 lg:py-7"
      >
        <ProductMark />
        <p className="text-[0.8125rem] text-rail-muted lg:max-w-[13rem]">
          <span className="hidden lg:inline">Compensation records for 10,000 synthetic ACME employees. </span>
          Synthetic data demo
        </p>
      </header>

      <main id="main" className="px-4 pt-8 pb-16 sm:px-8 lg:px-16 lg:pt-[12vh]">
        <div className="max-w-[34rem]">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Sign in</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            Choose a demo HR account, then enter the shared password.
          </p>
          <div className="mt-8">
            <Suspense fallback={<SignInSkeleton />}>
              <SignInPanel searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}

async function SignInPanel({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  // Request time: the demo password is injected per deployment, never baked in at build.
  await connection();
  const { reason } = await searchParams;
  const notice = typeof reason === "string" ? NOTICES[reason] : undefined;

  return (
    <>
      {notice ? (
        <Alert variant="info" role="status" className="mb-8">
          <Info aria-hidden="true" />
          <AlertDescription className="text-foreground">{notice}</AlertDescription>
        </Alert>
      ) : null}
      <SignInForm accounts={DEMO_ACCOUNTS} demoPassword={readDemoPassword()} />
    </>
  );
}

function SignInSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <p role="status" className="sr-only">
        Loading sign-in…
      </p>
      <Skeleton className="h-5 w-32 animate-none bg-muted" />
      <Skeleton className="h-24 w-full animate-none bg-muted" />
      <Skeleton className="h-24 w-full animate-none bg-muted" />
    </div>
  );
}
