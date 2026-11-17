import { CircleAlert, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

// Page-level failure states shared by protected pages. None shows backend messages, codes, or
// stack traces.

export function ServiceUnavailable({
  retryHref,
  className,
  service = "The compensation service",
}: {
  retryHref: string;
  className?: string;
  /** Which service did not respond; HR Access pages pass their own name. */
  service?: string;
}) {
  return (
    <Alert variant="destructive" className={className ?? "mt-8 max-w-2xl"}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle className="text-[#7d1a14]">{service} is not responding</AlertTitle>
      <AlertDescription className="text-[#7d1a14]">
        <p>Your session has not been ended. Try again in a moment.</p>
        <p>
          {/* A full page load, so the retry always asks the backend again. */}
          <a href={retryHref} className={buttonVariants({ variant: "outline", size: "sm", className: "no-underline" })}>
            Try again
          </a>
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function UnexpectedResponse({ retryHref }: { retryHref: string }) {
  return (
    <Alert variant="destructive" className="max-w-2xl">
      <CircleAlert aria-hidden="true" />
      <AlertTitle className="text-[#7d1a14]">The compensation service sent a response this page cannot read</AlertTitle>
      <AlertDescription className="text-[#7d1a14]">
        <p>No data is shown rather than showing something that may be wrong.</p>
        <p>
          <a href={retryHref} className={buttonVariants({ variant: "outline", size: "sm", className: "no-underline" })}>
            Try again
          </a>
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function NoticeAlert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert variant="info" className="max-w-2xl" role="status">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-foreground">{children}</AlertDescription>
    </Alert>
  );
}

/** The backend answered 403: the signed-in HR user is not current Admin HR. Nothing else is shown. */
export function ForbiddenState({ area }: { area: string }) {
  return (
    <Alert variant="destructive" className="mt-8 max-w-2xl">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle className="text-[#7d1a14]">Admin HR only</AlertTitle>
      <AlertDescription className="text-[#7d1a14]">
        <p>Your HR role cannot view {area}.</p>
      </AlertDescription>
    </Alert>
  );
}
