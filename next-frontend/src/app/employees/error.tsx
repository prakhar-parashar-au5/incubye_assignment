"use client";

import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Unexpected rendering failure. No error message or stack is shown; the digest lets an operator
// find the matching server log entry.
export default function EmployeesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="px-4 pt-10 pb-16 sm:px-8 lg:px-12">
      <Alert variant="destructive" className="max-w-2xl">
        <CircleAlert aria-hidden="true" />
        <AlertTitle className="text-[#7d1a14]">This page could not be loaded</AlertTitle>
        <AlertDescription className="text-[#7d1a14]">
          <p>Something went wrong on our side. Try again, or sign in again if the problem continues.</p>
          {error.digest ? <p className="font-mono text-[0.75rem]">Reference {error.digest}</p> : null}
          <p>
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Try again
            </Button>
          </p>
        </AlertDescription>
      </Alert>
    </main>
  );
}
